const router    = require('express').Router()
const authMW    = require('../middleware/auth')
const ItemPlan  = require('../models/ItemPlan')
const Inspeccion = require('../models/Inspeccion')

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

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

// ─── GET /plan ────────────────────────────────────────────────────────────────
router.get('/', authMW, async (req, res) => {
  try {
    const { estacion, anio } = req.query
    const filtro = { activo: true }
    if (estacion) filtro.estacion = estacion
    if (anio)     filtro.anio    = Number(anio)
    const items = await ItemPlan.find(filtro).sort({ equipo: 1 })
    res.json(items)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── GET /plan/cumplimiento ───────────────────────────────────────────────────
router.get('/cumplimiento', authMW, async (req, res) => {
  try {
    const anio      = Number(req.query.anio) || new Date().getFullYear()
    const estacion  = req.query.estacion
    const mesActual = new Date().getMonth()

    const filtro = { anio, activo: true }
    if (estacion) filtro.estacion = estacion
    const items = await ItemPlan.find(filtro).lean()

    if (!items.length) return res.json({ resultado: [], items: [] })

    // Inspecciones del año: contar por mes y por codigoPrefix
    const desde = new Date(anio, 0, 1)
    const hasta  = new Date(anio + 1, 0, 1)
    const filtroInsp = { createdAt: { $gte: desde, $lt: hasta } }
    if (estacion) filtroInsp.estacion = estacion
    const inspecciones = await Inspeccion.find(filtroInsp).select('createdAt equipos').lean()

    const ejecutadoPorMesPrefix = {}
    const ejecutadoPorMes = {}
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

    // Planificado = una verificación del equipo completo (no por tarea individual)
    // Si el item tiene unidades, planificado = frecuencia × cantidad de unidades
    const resultado = MESES.map((mes, mesIdx) => {
      const primerDia = new Date(anio, mesIdx, 1)
      const ultimoDia = new Date(anio, mesIdx + 1, 0)

      const itemsMes = items.filter(item => {
        const desde = item.vigenciaDesde ? new Date(item.vigenciaDesde) : new Date(anio, 0, 1)
        const hasta  = item.vigenciaHasta ? new Date(item.vigenciaHasta) : null
        return desde <= ultimoDia && (hasta === null || hasta >= primerDia)
      })

      let planificado = 0, ejecutado = 0
      for (const item of itemsMes) {
        const frec = frecuenciaMensual(item.periodicidad, mesIdx, anio)
        if (frec === 0) continue
        // Cada item = un evento de verificación del equipo completo
        // Si tiene unidades individuales, multiplica por cantidad de unidades
        const cantUnidades = item.unidades?.length || 1
        planificado += frec * cantUnidades
        if (item.codigoPrefix) {
          ejecutado += ejecutadoPorMesPrefix[mes]?.[item.codigoPrefix.toUpperCase()] || 0
        } else {
          ejecutado += ejecutadoPorMes[mes] || 0
        }
      }
      return { mes, planificado, ejecutado, porcentaje: planificado > 0 ? Math.round((ejecutado / planificado) * 100) : null }
    })

    // Items vigentes para mostrar en la tabla
    const hoy = new Date()
    const itemsVigentes = items.filter(i => !i.vigenciaHasta || new Date(i.vigenciaHasta) >= hoy)

    res.json({ resultado, items: itemsVigentes, mesActual: resultado[mesActual] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── POST /plan ───────────────────────────────────────────────────────────────
router.post('/', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    if (!Array.isArray(req.body.tareas) || !req.body.tareas.length) {
      return res.status(400).json({ error: 'Debe incluir al menos una tarea' })
    }
    const item = await ItemPlan.create(req.body)
    res.status(201).json(item)
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ─── PUT /plan/:id ────────────────────────────────────────────────────────────
router.put('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    const { periodicidad, aplicarDesde, ...resto } = req.body
    const itemActual = await ItemPlan.findById(req.params.id)
    if (!itemActual) return res.status(404).json({ error: 'Item no encontrado' })

    if (periodicidad && aplicarDesde) {
      // Versionar: cierra el actual y crea uno nuevo desde la fecha indicada
      const fechaDesde = new Date(aplicarDesde + 'T00:00:00')
      const fechaHasta = new Date(fechaDesde)
      fechaHasta.setDate(fechaHasta.getDate() - 1)

      itemActual.vigenciaHasta = fechaHasta
      await itemActual.save()

      const { _id, createdAt, updatedAt, __v, ...datosBase } = itemActual.toObject()
      const nuevoItem = await ItemPlan.create({ ...datosBase, periodicidad, vigenciaDesde: fechaDesde, vigenciaHasta: null })
      return res.status(201).json(nuevoItem)
    }

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
