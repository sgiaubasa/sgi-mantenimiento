const router    = require('express').Router()
const authMW    = require('../middleware/auth')
const ItemPlan  = require('../models/ItemPlan')
const Inspeccion = require('../models/Inspeccion')

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

// Cuántas veces debe aparecer una tarea en un mes según su periodicidad
function frecuenciaMensual(periodicidad, mes, anio) {
  const diasMes = new Date(anio, mes + 1, 0).getDate()
  switch (periodicidad) {
    case 'diario':       return diasMes
    case 'semanal':      return 4
    case 'quincenal':    return 2
    case 'mensual':      return 1
    case 'trimestral':   return mes % 3 === 0 ? 1 : 0
    case 'semestral':    return mes % 6 === 0 ? 1 : 0
    case 'anual':        return mes === 0 ? 1 : 0
    default:             return 0
  }
}

// ─── GET /plan?estacion=&anio= ────────────────────────────────────────────────
router.get('/', authMW, async (req, res) => {
  try {
    const { estacion, anio } = req.query
    const filtro = {}
    if (estacion) filtro.estacion = estacion
    if (anio)     filtro.anio    = Number(anio)
    const items = await ItemPlan.find({ ...filtro, activo: true }).sort({ equipo: 1, tarea: 1 })
    res.json(items)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── GET /plan/cumplimiento?estacion=&anio= ───────────────────────────────────
router.get('/cumplimiento', authMW, async (req, res) => {
  try {
    const anio      = Number(req.query.anio) || new Date().getFullYear()
    const estacion  = req.query.estacion
    const mesActual = new Date().getMonth() // 0-indexed

    // Traemos TODOS los ítems del año (activos, incluyendo versiones vencidas)
    const filtro = { anio, activo: true }
    if (estacion) filtro.estacion = estacion
    const items = await ItemPlan.find(filtro).lean()

    if (!items.length) return res.json({ resultado: [], porEquipo: [] })

    // Inspecciones reales del año, contadas por mes y por codigoPrefix
    const desde = new Date(anio, 0, 1)
    const hasta = new Date(anio + 1, 0, 1)
    const filtroInsp = { createdAt: { $gte: desde, $lt: hasta } }
    if (estacion) filtroInsp.estacion = estacion
    const inspecciones = await Inspeccion.find(filtroInsp).select('createdAt equipos').lean()

    const ejecutadoPorMesPrefix = {} // { 'enero': { 'CC': 2 } }
    const ejecutadoPorMes = {}       // { 'enero': 3 } — fallback sin prefijo
    for (const insp of inspecciones) {
      const mes = MESES[new Date(insp.createdAt).getMonth()]
      ejecutadoPorMes[mes] = (ejecutadoPorMes[mes] || 0) + 1
      if (!ejecutadoPorMesPrefix[mes]) ejecutadoPorMesPrefix[mes] = {}
      const prefijosInsp = new Set()
      for (const eq of (insp.equipos || [])) {
        const prefix = (eq.codigo || '').replace(/[-\s\d].*/, '').toUpperCase()
        if (prefix) prefijosInsp.add(prefix)
      }
      for (const p of prefijosInsp) {
        ejecutadoPorMesPrefix[mes][p] = (ejecutadoPorMesPrefix[mes][p] || 0) + 1
      }
    }

    // Por cada mes, filtra los ítems vigentes en ese mes (soporte a versionado de periodicidad)
    const resultado = MESES.map((mes, mesIdx) => {
      const primerDia = new Date(anio, mesIdx, 1)
      const ultimoDia = new Date(anio, mesIdx + 1, 0)

      // Ítem vigente en este mes: vigenciaDesde <= ultimoDia Y (vigenciaHasta nulo O >= primerDia)
      const itemsMes = items.filter(item => {
        const desde = item.vigenciaDesde ? new Date(item.vigenciaDesde) : new Date(anio, 0, 1)
        const hasta  = item.vigenciaHasta ? new Date(item.vigenciaHasta) : null
        return desde <= ultimoDia && (hasta === null || hasta >= primerDia)
      })

      let planificado = 0, ejecutado = 0
      for (const item of itemsMes) {
        const frec = frecuenciaMensual(item.periodicidad, mesIdx, anio)
        if (frec === 0) continue
        planificado += frec
        if (item.codigoPrefix) {
          ejecutado += ejecutadoPorMesPrefix[mes]?.[item.codigoPrefix.toUpperCase()] || 0
        } else {
          ejecutado += ejecutadoPorMes[mes] || 0
        }
      }
      return { mes, planificado, ejecutado, porcentaje: planificado > 0 ? Math.round((ejecutado / planificado) * 100) : null }
    })

    // Para la tabla del plan: mostrar solo ítems actualmente vigentes (sin vigenciaHasta o vigenciaHasta futura)
    const hoy = new Date()
    const itemsVigentes = items.filter(item => !item.vigenciaHasta || new Date(item.vigenciaHasta) >= hoy)
    const equiposMap = {}
    for (const item of itemsVigentes) {
      if (!equiposMap[item.equipo]) equiposMap[item.equipo] = []
      equiposMap[item.equipo].push(item)
    }
    const porEquipo = Object.entries(equiposMap).map(([equipo, tareas]) => ({
      equipo,
      tareas: tareas.map(t => ({
        _id: t._id, tarea: t.tarea, responsable: t.responsable,
        proveedorExterno: t.proveedorExterno, periodicidad: t.periodicidad,
        codigoPrefix: t.codigoPrefix, vigenciaDesde: t.vigenciaDesde
      }))
    }))

    res.json({ resultado, porEquipo, mesActual: resultado[mesActual] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── POST /plan ───────────────────────────────────────────────────────────────
router.post('/', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    const item = await ItemPlan.create(req.body)
    res.status(201).json(item)
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ─── POST /plan/bulk ──────────────────────────────────────────────────────────
// Carga múltiples items de una vez (para import)
router.post('/bulk', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    const { items } = req.body
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Array de items requerido' })
    const creados = await ItemPlan.insertMany(items)
    res.status(201).json({ creados: creados.length })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ─── PUT /plan/:id ────────────────────────────────────────────────────────────
// Si viene { periodicidad, aplicarDesde }: versiona el cambio (cierra el ítem actual y crea uno nuevo)
// Si no viene aplicarDesde: edición simple del ítem actual
router.put('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    const { periodicidad, aplicarDesde, ...resto } = req.body
    const itemActual = await ItemPlan.findById(req.params.id)
    if (!itemActual) return res.status(404).json({ error: 'Item no encontrado' })

    if (periodicidad && aplicarDesde) {
      // Versionado: cierra el item actual hasta el día anterior al aplicarDesde
      const fechaDesde   = new Date(aplicarDesde + 'T00:00:00')
      const fechaHasta   = new Date(fechaDesde)
      fechaHasta.setDate(fechaHasta.getDate() - 1) // día anterior

      itemActual.vigenciaHasta = fechaHasta
      await itemActual.save()

      // Crea nueva versión con nueva periodicidad, vigente desde la fecha elegida
      const { _id, createdAt, updatedAt, __v, ...datosBase } = itemActual.toObject()
      const nuevoItem = await ItemPlan.create({
        ...datosBase,
        periodicidad,
        vigenciaDesde: fechaDesde,
        vigenciaHasta: null
      })
      return res.status(201).json(nuevoItem)
    }

    // Edición simple (sin versionado)
    const item = await ItemPlan.findByIdAndUpdate(req.params.id, { periodicidad, ...resto }, { new: true })
    res.json(item)
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ─── DELETE /plan/:id ─────────────────────────────────────────────────────────
router.delete('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    await ItemPlan.findByIdAndUpdate(req.params.id, { activo: false })
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

module.exports = router
