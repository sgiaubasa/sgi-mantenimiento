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
    const anio     = Number(req.query.anio) || new Date().getFullYear()
    const estacion = req.query.estacion
    const mesActual = new Date().getMonth() // 0-indexed

    const filtro = { anio, activo: true }
    if (estacion) filtro.estacion = estacion
    const items = await ItemPlan.find(filtro).lean()

    if (!items.length) return res.json({ resultado: [], porEquipo: [] })

    // Inspecciones reales del año por mes
    const desde = new Date(anio, 0, 1)
    const hasta = new Date(anio + 1, 0, 1)
    const filtroInsp = { createdAt: { $gte: desde, $lt: hasta } }
    if (estacion) filtroInsp.estacion = estacion
    const inspecciones = await Inspeccion.find(filtroInsp).select('createdAt equipos estacion').lean()

    // Contar inspecciones reales por mes y por codigoPrefix
    const ejecutadoPorMesPrefix = {} // { 'enero': { 'CP': 5, 'AA': 3 } }
    const ejecutadoPorMes = {}       // { 'enero': 10 }
    for (const insp of inspecciones) {
      const mes = MESES[new Date(insp.createdAt).getMonth()]
      ejecutadoPorMes[mes] = (ejecutadoPorMes[mes] || 0) + 1
      if (!ejecutadoPorMesPrefix[mes]) ejecutadoPorMesPrefix[mes] = {}
      for (const eq of (insp.equipos || [])) {
        const prefix = (eq.codigo || '').slice(0, 2).toUpperCase()
        ejecutadoPorMesPrefix[mes][prefix] = (ejecutadoPorMesPrefix[mes][prefix] || 0) + 1
      }
    }

    // Calcular planificado por mes (suma de frecuencias de todos los items)
    const resultado = MESES.map((mes, mesIdx) => {
      let planificado = 0
      for (const item of items) {
        planificado += frecuenciaMensual(item.periodicidad, mesIdx, anio)
      }
      const ejecutado = ejecutadoPorMes[mes] || 0
      return {
        mes,
        planificado,
        ejecutado,
        porcentaje: planificado > 0 ? Math.round((ejecutado / planificado) * 100) : null
      }
    })

    // Agrupar por equipo para mostrar tabla detalle
    const equiposMap = {}
    for (const item of items) {
      if (!equiposMap[item.equipo]) equiposMap[item.equipo] = []
      equiposMap[item.equipo].push(item)
    }
    const porEquipo = Object.entries(equiposMap).map(([equipo, tareas]) => ({
      equipo,
      tareas: tareas.map(t => ({
        _id: t._id,
        tarea:            t.tarea,
        responsable:      t.responsable,
        proveedorExterno: t.proveedorExterno,
        periodicidad:     t.periodicidad,
        codigoPrefix:     t.codigoPrefix
      }))
    }))

    const mesData = resultado[mesActual]
    res.json({ resultado, porEquipo, mesActual: mesData })
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
router.put('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    const item = await ItemPlan.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!item) return res.status(404).json({ error: 'Item no encontrado' })
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
