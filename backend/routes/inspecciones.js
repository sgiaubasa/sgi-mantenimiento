const router     = require('express').Router()
const multer     = require('multer')
const authMW     = require('../middleware/auth')
const Inspeccion = require('../models/Inspeccion')
const Desvio     = require('../models/Desvio')
const ItemPlan   = require('../models/ItemPlan')
const { analyzeDocument } = require('../services/visionAnalysis')

const TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']

// Parsea fechas YYYY-MM-DD como mediodía para evitar el desfase UTC-3
function parseDate(str) {
  if (!str) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00')
  return new Date(str)
}

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
// Analiza uno o varios archivos con IA y fusiona los resultados. No guarda en DB.
router.post('/analizar', authMW, upload.array('archivos', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No se recibió ningún archivo' })

  try {
    // Analizar cada archivo en paralelo
    const resultados = await Promise.all(
      req.files.map(f => analyzeDocument(f.buffer, f.mimetype))
    )

    // Fusionar resultados en un solo objeto
    const analisis = fusionarAnalisis(resultados)

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

function fusionarAnalisis(resultados) {
  const merged = {
    estacion:              null,
    fecha:                 null,
    operador:              null,
    tareasVerificadas:     [],
    equipos:               [],
    observacionesGenerales: null
  }
  const obsArr = []
  for (const r of resultados) {
    if (!merged.estacion  && r.estacion)  merged.estacion  = r.estacion
    if (!merged.fecha     && r.fecha)     merged.fecha     = r.fecha
    if (!merged.operador  && r.operador)  merged.operador  = r.operador
    if (r.observacionesGenerales) obsArr.push(r.observacionesGenerales)
    // Unión de tareas verificadas (sin duplicados)
    for (const t of (r.tareasVerificadas || [])) {
      if (!merged.tareasVerificadas.includes(t)) merged.tareasVerificadas.push(t)
    }
    // Acumular equipos (sin duplicar por código)
    for (const eq of (r.equipos || [])) {
      const existe = merged.equipos.find(e => e.codigo === eq.codigo)
      if (!existe) merged.equipos.push(eq)
    }
  }
  if (obsArr.length) merged.observacionesGenerales = obsArr.join(' | ')
  return merged
}

// ─── POST / ──────────────────────────────────────────────────────────────────
// Guarda la inspección completa junto con gestión de desvíos.
// Body (multipart):
//   archivo:   File  — documento analizado por IA (se guarda como evidencia)
//   evidencia: File? — archivo adicional de evidencia (opcional, solo si no viene con archivo IA)
//   datos:     JSON string { analisis, estacion, desviosNuevos[], desviosCerrar[] }
router.post('/', authMW, upload.fields([{ name: 'archivos', maxCount: 10 }, { name: 'evidencia', maxCount: 1 }]), async (req, res) => {
  const archivosIA  = req.files?.archivos || []
  const archivoIA   = archivosIA[0]
  const archivoEv   = req.files?.evidencia?.[0]
  if (!archivoIA) return res.status(400).json({ error: 'No se recibió archivo' })

  let body
  try {
    body = JSON.parse(req.body.datos || '{}')
  } catch {
    return res.status(400).json({ error: 'El campo "datos" no es JSON válido' })
  }

  const { analisis, estacion, desviosNuevos = [], desviosCerrar = [] } = body

  if (!analisis) return res.status(400).json({ error: 'Faltan datos del análisis de IA' })

  const tieneFallas = (analisis.equipos || []).some(e => e.estado === 'falla')

  if (tieneFallas && desviosNuevos.length === 0) {
    return res.status(400).json({
      error: 'Los desvíos detectados requieren gestión obligatoria antes de guardar.'
    })
  }

  // La evidencia es el archivo extra si existe, sino el documento IA
  const evArchivo = archivoEv || archivoIA

  try {
    // 1. Guardar inspección
    const insp = new Inspeccion({
      estacion:              analisis.estacion || estacion || 'No especificada',
      operador:              analisis.operador  || null,
      fecha:                 analisis.fecha ? parseDate(analisis.fecha) : new Date(),
      archivoNombre:         archivoIA.originalname,
      archivoMimeType:       archivoIA.mimetype,
      equipos:               analisis.equipos || [],
      tieneFallas,
      tareasVerificadas:     analisis.tareasVerificadas || [],
      observacionesGenerales: analisis.observacionesGenerales || null,
      evidenciaNombre:       evArchivo.originalname,
      evidenciaMimeType:     evArchivo.mimetype,
      evidenciaData:         evArchivo.buffer
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
        fechaEstimadaEjecucion: parseDate(d.fechaEstimadaEjecucion),
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
router.post('/manual', authMW, upload.single('evidencia'), async (req, res) => {
  let parsed = {}
  try { parsed = JSON.parse(req.body.datos || '{}') } catch { return res.status(400).json({ error: 'datos inválido' }) }
  const { itemPlanId, fecha, unidades = [], tareasVerificadas = [], observaciones, desviosNuevos = [] } = parsed
  if (!itemPlanId) return res.status(400).json({ error: 'itemPlanId requerido' })

  try {
    const item = await ItemPlan.findById(itemPlanId).lean()
    if (!item) return res.status(404).json({ error: 'Item del plan no encontrado' })

    const codigosConFalla = new Set(desviosNuevos.map(d => d.codigoEquipo).filter(Boolean))
    const unidadesAVerificar = unidades.length
      ? unidades
      : (item.unidades?.length ? item.unidades : [item.codigoPrefix || item.equipo])

    const equipos = unidadesAVerificar.map(u => ({
      codigo:      u,
      descripcion: item.equipo,
      estado:      codigosConFalla.has(u) ? 'falla' : 'correcto',
      observacion: codigosConFalla.has(u)
        ? (desviosNuevos.find(d => d.codigoEquipo === u)?.observacionFalla || null)
        : null
    }))

    const tieneFallas = equipos.some(e => e.estado === 'falla')

    const insp = await Inspeccion.create({
      estacion:              item.estacion,
      fecha:                 fecha ? parseDate(fecha) : new Date(),
      archivoNombre:         'Verificación manual',
      equipos,
      tieneFallas,
      tareasVerificadas:     tareasVerificadas.length ? tareasVerificadas : (item.tareas || []),
      observacionesGenerales: observaciones || null,
      tipoVerificacion:      'Personal AUBASA',
      usuarioId:             req.usuario._id,
      evidenciaNombre:       req.file ? req.file.originalname : null,
      evidenciaMimeType:     req.file ? req.file.mimetype : null,
      evidenciaData:         req.file ? req.file.buffer : null
    })

    // Crear desvíos
    const idsDesvios = []
    for (const d of desviosNuevos) {
      const dev = await Desvio.create({
        codigoEquipo:           d.codigoEquipo,
        descripcionEquipo:      d.descripcionEquipo,
        observacionFalla:       d.observacionFalla,
        descripcionDesvio:      d.descripcionDesvio,
        accionImplementar:      d.accionImplementar,
        fechaEstimadaEjecucion: parseDate(d.fechaEstimadaEjecucion),
        estado:                 'Pendiente',
        idInspeccionOrigen:     insp._id
      })
      idsDesvios.push(dev._id)
    }
    if (idsDesvios.length) { insp.desviosGenerados = idsDesvios; await insp.save() }

    res.status(201).json({ inspeccion: insp, desviosCreados: idsDesvios })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ─── GET /kpis ───────────────────────────────────────────────────────────────
// Acepta ?estacion=&desde=YYYY-MM&hasta=YYYY-MM (ambos inclusive)
router.get('/kpis', authMW, async (req, res) => {
  try {
    const { estacion, desde: desdeParam, hasta: hastaParam } = req.query
    const now = new Date()

    const parseMes = (str, defaultDate) => {
      if (!str) return defaultDate
      const [y, m] = str.split('-').map(Number)
      return new Date(y, m - 1, 1)
    }
    const desde = parseMes(desdeParam, new Date(now.getFullYear(), now.getMonth(), 1))
    const hastaBase = parseMes(hastaParam, new Date(now.getFullYear(), now.getMonth(), 1))
    const hasta = new Date(hastaBase.getFullYear(), hastaBase.getMonth() + 1, 1)

    const filtroFecha = { createdAt: { $gte: desde, $lt: hasta } }
    const filtroInsp  = estacion ? { ...filtroFecha, estacion } : { ...filtroFecha }
    const filtroFechaInsp = { ...filtroFecha }

    const [totalMes, conFallasMes, pendientes, cerradosMes, inspeccionesMes, desviosDetectadosMes] = await Promise.all([
      Inspeccion.countDocuments(filtroInsp),
      Inspeccion.countDocuments({ ...filtroInsp, tieneFallas: true }),
      Desvio.countDocuments({ estado: 'Pendiente' }),
      Desvio.countDocuments({ estado: 'Cerrado', updatedAt: { $gte: desde, $lt: hasta } }),
      Inspeccion.find(filtroInsp).select('equipos').lean(),
      Desvio.countDocuments(filtroFechaInsp)
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

// ─── PUT /:id ─── edición de inspección (solo admin) ─────────────────────────
// Body: { fecha?, observacionesGenerales?, desviosNuevos[] }
router.put('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    const insp = await Inspeccion.findById(req.params.id)
    if (!insp) return res.status(404).json({ error: 'Inspección no encontrada' })

    const { fecha, observacionesGenerales, desviosNuevos = [] } = req.body

    if (fecha)                          insp.fecha = parseDate(fecha)
    if (observacionesGenerales !== undefined) insp.observacionesGenerales = observacionesGenerales || null

    // Agregar nuevos desvíos
    const idsNuevos = []
    for (const d of desviosNuevos) {
      const dev = await Desvio.create({
        codigoEquipo:           d.codigoEquipo,
        descripcionEquipo:      d.descripcionEquipo,
        observacionFalla:       d.observacionFalla,
        descripcionDesvio:      d.descripcionDesvio,
        accionImplementar:      d.accionImplementar,
        fechaEstimadaEjecucion: parseDate(d.fechaEstimadaEjecucion),
        estado:                 'Pendiente',
        idInspeccionOrigen:     insp._id
      })
      idsNuevos.push(dev._id)
    }
    if (idsNuevos.length) {
      insp.desviosGenerados = [...(insp.desviosGenerados || []), ...idsNuevos]
      insp.tieneFallas = true
    }

    await insp.save()
    res.json({ inspeccion: insp, desviosCreados: idsNuevos })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ─── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', authMW, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  try {
    const insp = await Inspeccion.findByIdAndDelete(req.params.id)
    if (!insp) return res.status(404).json({ error: 'Inspección no encontrada' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /:id/evidencia ───────────────────────────────────────────────────────
router.get('/:id/evidencia', authMW, async (req, res) => {
  try {
    const insp = await Inspeccion.findById(req.params.id)
      .select('evidenciaData evidenciaMimeType evidenciaNombre')
    if (!insp?.evidenciaData) return res.status(404).json({ error: 'Sin evidencia registrada' })
    res.set('Content-Type', insp.evidenciaMimeType)
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(insp.evidenciaNombre)}"`)
    res.send(insp.evidenciaData)
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
      .select('-evidenciaData')
      .populate('desviosGenerados', 'estado codigoEquipo')
    res.json(inspecciones)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
