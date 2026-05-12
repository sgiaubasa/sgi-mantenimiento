const router  = require('express').Router()
const authMW  = require('../middleware/auth')
const Plan    = require('../models/PlanMantenimiento')
const Inspeccion = require('../models/Inspeccion')

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

// ─── GET /plan?estacion=...&anio=... ─────────────────────────────────────────
router.get('/', authMW, async (req, res) => {
  try {
    const { estacion, anio } = req.query
    const filtro = {}
    if (estacion) filtro.estacion = estacion
    if (anio)     filtro.anio    = Number(anio)
    const planes = await Plan.find(filtro).sort({ categoria: 1 })
    res.json(planes)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /plan/cumplimiento?estacion=...&anio=... ─────────────────────────────
// Devuelve planificado vs ejecutado por mes para el indicador principal
router.get('/cumplimiento', authMW, async (req, res) => {
  try {
    const anio     = Number(req.query.anio) || new Date().getFullYear()
    const estacion = req.query.estacion

    const filtroInsp = {}
    if (estacion) filtroInsp.estacion = estacion

    // Contar inspecciones reales por mes
    const desde = new Date(anio, 0, 1)
    const hasta = new Date(anio + 1, 0, 1)
    const inspecciones = await Inspeccion.find({
      ...filtroInsp,
      createdAt: { $gte: desde, $lt: hasta }
    }).select('createdAt').lean()

    const ejecutadoPorMes = {}
    for (const insp of inspecciones) {
      const mes = MESES[new Date(insp.createdAt).getMonth()]
      ejecutadoPorMes[mes] = (ejecutadoPorMes[mes] || 0) + 1
    }

    // Sumar planificado por mes (todas las categorías de la estación/año)
    const filtro = { anio }
    if (estacion) filtro.estacion = estacion
    const planes = await Plan.find(filtro).lean()

    const planificadoPorMes = {}
    for (const p of planes) {
      for (const mes of MESES) {
        planificadoPorMes[mes] = (planificadoPorMes[mes] || 0) + (p.planificado?.[mes] || 0)
      }
    }

    const resultado = MESES.map(mes => ({
      mes,
      planificado: planificadoPorMes[mes] || 0,
      ejecutado:   ejecutadoPorMes[mes]   || 0,
      porcentaje:  planificadoPorMes[mes]
        ? Math.round(((ejecutadoPorMes[mes] || 0) / planificadoPorMes[mes]) * 100)
        : null
    }))

    // KPI del mes actual
    const mesActual = MESES[new Date().getMonth()]
    const dataMes   = resultado.find(r => r.mes === mesActual)

    res.json({ resultado, mesActual: dataMes })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /plan ───────────────────────────────────────────────────────────────
// Crea o actualiza plan por estacion/anio/categoria (upsert)
router.post('/', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores pueden modificar el plan' })
  }
  try {
    const { estacion, anio, categoria, planificado } = req.body
    if (!estacion || !anio || !categoria) {
      return res.status(400).json({ error: 'estacion, anio y categoria son requeridos' })
    }
    const plan = await Plan.findOneAndUpdate(
      { estacion, anio: Number(anio), categoria },
      { planificado },
      { upsert: true, new: true, runValidators: true }
    )
    res.status(201).json(plan)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ─── PUT /plan/:id ────────────────────────────────────────────────────────────
router.put('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores pueden modificar el plan' })
  }
  try {
    const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' })
    res.json(plan)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ─── DELETE /plan/:id ─────────────────────────────────────────────────────────
router.delete('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' })
  }
  try {
    await Plan.findByIdAndDelete(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

module.exports = router
