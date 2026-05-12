const router = require('express').Router()
const Desvio = require('../models/Desvio')

// ─── GET /pendientes ─────────────────────────────────────────────────────────
router.get('/pendientes', async (req, res) => {
  try {
    const desvios = await Desvio.find({ estado: 'Pendiente' })
      .populate('idInspeccionOrigen', 'estacion fecha archivoNombre')
      .sort({ createdAt: -1 })
    res.json(desvios)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── GET / ── historial completo con filtros ─────────────────────────────────
// ?estado=Pendiente|Cerrado  ?estacion=...  ?desde=YYYY-MM  ?hasta=YYYY-MM
router.get('/', async (req, res) => {
  try {
    const { estado, estacion, desde: desdeParam, hasta: hastaParam } = req.query
    const filter = {}
    if (estado) filter.estado = estado

    // Filtro por fecha de creación
    if (desdeParam || hastaParam) {
      filter.createdAt = {}
      if (desdeParam) {
        const [y, m] = desdeParam.split('-').map(Number)
        filter.createdAt.$gte = new Date(y, m - 1, 1)
      }
      if (hastaParam) {
        const [y, m] = hastaParam.split('-').map(Number)
        filter.createdAt.$lt  = new Date(y, m, 1)
      }
    }

    let desvios = await Desvio.find(filter)
      .populate('idInspeccionOrigen', 'estacion fecha archivoNombre')
      .populate('idInspeccionCierre', 'estacion fecha')
      .sort({ createdAt: -1 })
      .lean()

    // Filtro por estación (via inspección origen — en memoria, es un conjunto pequeño)
    if (estacion) {
      desvios = desvios.filter(d => d.idInspeccionOrigen?.estacion === estacion)
    }

    res.json(desvios)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── PUT /:id/cerrar ─────────────────────────────────────────────────────────
// Cierre manual: el usuario registra fecha real y evalúa eficacia
router.put('/:id/cerrar', async (req, res) => {
  try {
    const { fechaRealCierre, eficacia } = req.body
    const desvio = await Desvio.findById(req.params.id)

    if (!desvio)                   return res.status(404).json({ error: 'Desvío no encontrado' })
    if (desvio.estado === 'Cerrado') return res.status(400).json({ error: 'El desvío ya está cerrado' })
    if (!eficacia)                 return res.status(400).json({ error: 'La eficacia es requerida' })

    desvio.estado         = 'Cerrado'
    desvio.fechaRealCierre = fechaRealCierre ? new Date(fechaRealCierre) : new Date()
    desvio.eficacia       = eficacia
    desvio.motivoCierre   = 'manual'
    await desvio.save()

    res.json(desvio)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

module.exports = router
