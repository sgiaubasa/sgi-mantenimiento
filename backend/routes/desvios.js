const authMW = require('../middleware/auth')
const router    = require('express').Router()
const Desvio    = require('../models/Desvio')
const Inspeccion = require('../models/Inspeccion')

function parseDate(str) {
  if (!str) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00')
  return new Date(str)
}

// ─── GET /pendientes ─────────────────────────────────────────────────────────
router.get('/pendientes', authMW, async (req, res) => {
  try {
    const filter = { estado: 'Pendiente' }
    if (req.usuario.rol !== 'admin' && !(req.usuario.estaciones || []).includes('Todas')) {
      const allowed = req.usuario.estaciones || [];
      const inspIds = await Inspeccion.find({ estacion: { $in: allowed } }).select('_id').lean();
      filter.idInspeccionOrigen = { $in: inspIds.map(i => i._id) };
    }

    const desvios = await Desvio.find(filter)
      .populate('idInspeccionOrigen', 'estacion fecha archivoNombre')
      .sort({ createdAt: -1 })
    res.json(desvios)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── GET / ── historial completo con filtros ─────────────────────────────────
// ?estado=Pendiente|Cerrado  ?estacion=...  ?desde=YYYY-MM  ?hasta=YYYY-MM
router.get('/', authMW, async (req, res) => {
  try {
    const { estado, estacion, desde: desdeParam, hasta: hastaParam } = req.query
    const filter = {}
    if (estado) filter.estado = estado

    const filtroInsp = {}
    if (desdeParam) {
      const [y, m] = desdeParam.split('-').map(Number)
      filtroInsp.$gte = new Date(y, m - 1, 1)
    }
    if (hastaParam) {
      const [y, m] = hastaParam.split('-').map(Number)
      filtroInsp.$lt = new Date(y, m, 1)
    }

    const filtroFechaInsp = {}
    if (desdeParam || hastaParam) filtroFechaInsp.fecha = filtroInsp

    if (req.usuario.rol !== 'admin' && !(req.usuario.estaciones || []).includes('Todas')) {
      const allowed = req.usuario.estaciones || [];
      if (estacion && !allowed.includes(estacion)) {
        return res.json([]); // No tiene permiso para esta estación
      }
      filtroFechaInsp.estacion = estacion ? estacion : { $in: allowed };
    } else if (estacion) {
      filtroFechaInsp.estacion = estacion;
    }

    if (Object.keys(filtroFechaInsp).length > 0) {
      const inspIds = await Inspeccion.find(filtroFechaInsp).select('_id').lean()
      filter.idInspeccionOrigen = { $in: inspIds.map(i => i._id) }
    }

    const desvios = await Desvio.find(filter)
      .populate('idInspeccionOrigen', 'estacion fecha archivoNombre')
      .populate('idInspeccionCierre', 'estacion fecha')
      .sort({ createdAt: -1 })
      .lean()

    res.json(desvios)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── PUT /:id ─── edición de campos del desvío (solo admin) ──────────────────

router.put('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    const desvio = await Desvio.findById(req.params.id)
    if (!desvio) return res.status(404).json({ error: 'Desvío no encontrado' })

    const { codigoEquipo, descripcionEquipo, observacionFalla, descripcionDesvio, accionImplementar, fechaEstimadaEjecucion } = req.body
    if (codigoEquipo           !== undefined) desvio.codigoEquipo           = codigoEquipo
    if (descripcionEquipo      !== undefined) desvio.descripcionEquipo      = descripcionEquipo
    if (observacionFalla       !== undefined) desvio.observacionFalla       = observacionFalla
    if (descripcionDesvio      !== undefined) desvio.descripcionDesvio      = descripcionDesvio
    if (accionImplementar      !== undefined) desvio.accionImplementar      = accionImplementar
    if (fechaEstimadaEjecucion !== undefined) desvio.fechaEstimadaEjecucion = parseDate(fechaEstimadaEjecucion)

    await desvio.save()
    res.json(desvio)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ─── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    const desvio = await Desvio.findByIdAndDelete(req.params.id)
    if (!desvio) return res.status(404).json({ error: 'Desvío no encontrado' })
    res.json({ ok: true })
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
    desvio.fechaRealCierre = fechaRealCierre ? parseDate(fechaRealCierre) : new Date()
    desvio.eficacia       = eficacia
    desvio.motivoCierre   = 'manual'
    await desvio.save()

    res.json(desvio)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

module.exports = router
