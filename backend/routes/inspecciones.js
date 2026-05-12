const router     = require('express').Router()
const multer     = require('multer')
const authMW     = require('../middleware/auth')
const Inspeccion = require('../models/Inspeccion')
const Desvio     = require('../models/Desvio')
const ItemPlan   = require('../models/ItemPlan')
const { analyzeDocument } = require('../services/visionAnalysis')

const TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Formato no soportado. Usá PDF, JPG, PNG o WebP.'))
    }
  }
})

// ─── POST /analizar ──────────────────────────────────────────────────────────
// Analiza el documento con IA. No guarda en DB. Devuelve:
//   - analisis: { estacion, fecha, operador, equipos, observacionesGenerales }
//   - desviosCierrePosible: desvíos abiertos para equipos que aparecen como "correcto"
router.post('/analizar', authMW, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' })

  try {
    const analisis = await analyzeDocument(req.file.buffer, req.file.mimetype)

    // Buscar desvíos abiertos para equipos que aparecen como "correcto" en el nuevo doc
    const codigosOk = (analisis.equipos || [])
      .filter(e => e.estado === 'correcto')
      .map(e => e.codigo)
      .filter(Boolean)

    const desviosCierrePosible = codigosOk.length
      ? await Desvio.find({ codigoEquipo: { $in: codigosOk }, estado: 'Pendiente' })
          .select('_id codigoEquipo descripcionEquipo observacionFalla descripcionDesvio createdAt')
          .lean()
      : []

    res.json({ analisis, desviosCierrePosible })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST / ──────────────────────────────────────────────────────────────────
// Guarda la inspección completa junto con gestión de desvíos.
// Body (multipart):
//   archivo: File
//   datos:   JSON string { analisis, estacion, desviosNuevos[], desviosCerrar[] }
router.post('/', authMW, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' })

  let body
  try {
    body = JSON.parse(req.body.datos || '{}')
  } catch {
    return res.status(400).json({ error: 'El campo "datos" no es JSON válido' })
  }

  const { analisis, estacion, desviosNuevos = [], desviosCerrar = [] } = body

  if (!analisis) return res.status(400).json({ error: 'Faltan datos del análisis de IA' })

  const tieneFallas = (analisis.equipos || []).some(e => e.estado === 'falla')

  // Regla de negocio: si hay fallas, deben gestionarse antes de guardar
  if (tieneFallas && desviosNuevos.length === 0) {
    return res.status(400).json({
      error: 'Los desvíos detectados requieren gestión obligatoria antes de guardar.'
    })
  }

  try {
    // 1. Guardar inspección
    const insp = new Inspeccion({
      estacion:              analisis.estacion || estacion || 'No especificada',
      operador:              analisis.operador  || null,
      fecha:                 analisis.fecha ? new Date(analisis.fecha) : new Date(),
      archivoNombre:         req.file.originalname,
      archivoMimeType:       req.file.mimetype,
      equipos:               analisis.equipos || [],
      tieneFallas,
      tareasVerificadas:     analisis.tareasVerificadas || [],
      observacionesGenerales: analisis.observacionesGenerales || null
    })
    await insp.save()

    // 2. Crear nuevos desvíos para cada falla detectada
    const idsDesviosCreados = []
    for (const d of desviosNuevos) {
      const desvio = await Desvio.create({
        codigoEquipo:           d.codigoEquipo,
        descripcionEquipo:      d.descripcionEquipo,
        observacionFalla:       d.observacionFalla,
        descripcionDesvio:      d.descripcionDesvio,
        accionImplementar:      d.accionImplementar,
        fechaEstimadaEjecucion: new Date(d.fechaEstimadaEjecucion),
        estado:                 'Pendiente',
        idInspeccionOrigen:     insp._id
      })
      idsDesviosCreados.push(desvio._id)
    }
    if (idsDesviosCreados.length) {
      insp.desviosGenerados = idsDesviosCreados
      await insp.save()
    }

    // 3. Cerrar desvíos anteriores (cierre automático por próxima carga)
    const idsCerrados = []
    for (const id of desviosCerrar) {
      const dev = await Desvio.findById(id)
      if (dev && dev.estado === 'Pendiente') {
        dev.estado            = 'Cerrado'
        dev.idInspeccionCierre = insp._id
        dev.fechaRealCierre   = new Date()
        dev.eficacia          = 'Eficaz'
        dev.motivoCierre      = 'automatico'
        await dev.save()
        idsCerrados.push(id)
      }
    }

    res.status(201).json({
      inspeccion:    insp,
      desviosCreados: idsDesviosCreados,
      desviosCerrados: idsCerrados
    })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ─── POST /manual ────────────────────────────────────────────────────────────
// Registra una verificación manual sin IA. Crea un registro de Inspeccion
// con los equipos/unidades confirmados como "correcto", para que cuente
// en el indicador de cumplimiento del plan.
router.post('/manual', authMW, async (req, res) => {
  const { itemPlanId, fecha, unidades = [], tareasVerificadas = [], observaciones } = req.body
  if (!itemPlanId) return res.status(400).json({ error: 'itemPlanId requerido' })

  try {
    const item = await ItemPlan.findById(itemPlanId).lean()
    if (!item) return res.status(404).json({ error: 'Item del plan no encontrado' })

    // Si no especificaron unidades, usa todas las del plan (o el código genérico)
    const unidadesAVerificar = unidades.length
      ? unidades
      : (item.unidades?.length ? item.unidades : [item.codigoPrefix || item.equipo])

    const equipos = unidadesAVerificar.map(u => ({
      codigo:      u,
      descripcion: item.equipo,
      estado:      'correcto',
      observacion: null
    }))

    const insp = await Inspeccion.create({
      estacion:              item.estacion,
      fecha:                 fecha ? new Date(fecha) : new Date(),
      archivoNombre:         'Verificación manual',
      equipos,
      tieneFallas:           false,
      tareasVerificadas:     tareasVerificadas.length ? tareasVerificadas : (item.tareas || []),
      observacionesGenerales: observaciones || null,
      tipoVerificacion:      'Personal AUBASA',
      usuarioId:             req.usuario._id
    })

    res.status(201).json({ inspeccion: insp })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ─── GET /kpis ───────────────────────────────────────────────────────────────
router.get('/kpis', authMW, async (req, res) => {
  try {
    const now   = new Date()
    const desde = new Date(now.getFullYear(), now.getMonth(), 1)
    const hasta = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const filtroMes = { createdAt: { $gte: desde, $lt: hasta } }

    const [totalMes, conFallasMes, pendientes, cerradosMes, inspeccionesMes, desviosDetectadosMes] = await Promise.all([
      Inspeccion.countDocuments(filtroMes),
      Inspeccion.countDocuments({ ...filtroMes, tieneFallas: true }),
      Desvio.countDocuments({ estado: 'Pendiente' }),
      Desvio.countDocuments({ estado: 'Cerrado', updatedAt: { $gte: desde, $lt: hasta } }),
      Inspeccion.find(filtroMes).select('equipos').lean(),
      Desvio.countDocuments({ createdAt: { $gte: desde, $lt: hasta } })
    ])

    // Indicador de Disponibilidad: ítems conformes / total ítems verificados
    let itemsConformes = 0, itemsTotal = 0
    for (const insp of inspeccionesMes) {
      for (const eq of (insp.equipos || [])) {
        itemsTotal++
        if (eq.estado === 'correcto') itemsConformes++
      }
    }
    const disponibilidad = itemsTotal > 0
      ? Math.round((itemsConformes / itemsTotal) * 100)
      : null

    // Indicador de Eficacia de Desvíos: cerrados / detectados este mes
    const eficaciaDesvios = desviosDetectadosMes > 0
      ? Math.round((cerradosMes / desviosDetectadosMes) * 100)
      : null

    res.json({
      totalMes, conFallasMes,
      pendientes, cerradosMes,
      itemsConformes, itemsTotal, disponibilidad,
      desviosDetectadosMes, eficaciaDesvios
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── GET / ───────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const inspecciones = await Inspeccion.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('desviosGenerados', 'estado codigoEquipo')
    res.json(inspecciones)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
