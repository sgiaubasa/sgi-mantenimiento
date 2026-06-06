const router    = require('express').Router()
const authMW    = require('../middleware/auth')
const ItemPlan  = require('../models/ItemPlan')
const Inspeccion = require('../models/Inspeccion')

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

// Calcula la frecuencia planificada para un ítem considerando SOLO los días
// en que estuvo activo dentro del mes (soporta cambios de periodicidad a mitad de mes).
// diasActivos: cantidad de días que el ítem estuvo vigente en ese mes.
// diasMes: total de días del mes.
function frecuenciaParcial(periodicidad, diasActivos, diasMes, mesIdx, mesInicio = 0) {
  if (diasActivos <= 0) return 0
  switch (periodicidad) {
    case 'diario':     return diasActivos
    case 'semanal':    return Math.round(diasActivos / 7)
    case 'quincenal':  return Math.round(diasActivos / 15)
    // Para mensual y superiores: si el ítem estuvo activo al menos 7 días Y el mes
    // corresponde al ciclo, se cuenta 1. Así un cambio el día 8 genera 1 ocurrencia
    // en el período anterior (días 1-7) y días×frecuencia en el nuevo período.
    case 'mensual':    return diasActivos >= 7 ? 1 : 0
    case 'bimestral':  return (mesIdx - mesInicio + 12) % 2 === 0 && diasActivos >= 7 ? 1 : 0
    case 'trimestral': return (mesIdx - mesInicio + 12) % 3 === 0 && diasActivos >= 7 ? 1 : 0
    case 'semestral':  return (mesIdx - mesInicio + 12) % 6 === 0 && diasActivos >= 7 ? 1 : 0
    case 'anual':      return mesIdx === mesInicio && diasActivos >= 7 ? 1 : 0
    default:           return 0
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

    // Inspecciones del año filtradas por fecha de verificación (campo fecha, no createdAt)
    const desde      = new Date(anio, 0, 1)
    const hasta      = new Date(anio + 1, 0, 1)
    const filtroInsp = { fecha: { $gte: desde, $lt: hasta } }
    if (estacion) filtroInsp.estacion = estacion
    const inspecciones = await Inspeccion.find(filtroInsp)
      .select('equipos tareasVerificadas fecha planItemId')
      .lean()

    // Dos mapas: por planItemId (directo) y por prefix (legacy/sin planItemId)
    const ejecutadoPorItemId = {}
    const ejecutadoPorPrefix = {}

    for (const insp of inspecciones) {
      const mes         = MESES[new Date(insp.fecha).getMonth()]
      const tareasCount = Math.max((insp.tareasVerificadas || []).length, 1)

      if (insp.planItemId) {
        if (!ejecutadoPorItemId[mes]) ejecutadoPorItemId[mes] = {}
        const pid   = insp.planItemId.toString()
        const units = Math.max((insp.equipos || []).length, 1)
        ejecutadoPorItemId[mes][pid] = (ejecutadoPorItemId[mes][pid] || 0) + (units * tareasCount)
      } else {
        if (!ejecutadoPorPrefix[mes]) ejecutadoPorPrefix[mes] = {}
        const unidadesPorPrefix = {}
        for (const eq of (insp.equipos || [])) {
          const prefix = (eq.codigo || '').replace(/[-\s\d].*/, '').toUpperCase()
          if (prefix) unidadesPorPrefix[prefix] = (unidadesPorPrefix[prefix] || 0) + 1
        }
        for (const [prefix, unidades] of Object.entries(unidadesPorPrefix)) {
          ejecutadoPorPrefix[mes][prefix] = (ejecutadoPorPrefix[mes][prefix] || 0) + (unidades * tareasCount)
        }
      }
    }

    const resultado = MESES.map((mes, mesIdx) => {
      const primerDia = new Date(anio, mesIdx, 1)
      const ultimoDia = new Date(anio, mesIdx + 1, 0)
      const diasMes   = ultimoDia.getDate()

      const itemsMes = items.filter(item => {
        if (!(item.tareas?.length)) return false
        const vigDesde = item.vigenciaDesde ? new Date(item.vigenciaDesde) : new Date(anio, 0, 1)
        const vigHasta = item.vigenciaHasta ? new Date(item.vigenciaHasta) : null
        return vigDesde <= ultimoDia && (vigHasta === null || vigHasta >= primerDia)
      })

      let planificado = 0, ejecutado = 0
      // Rastrear prefijos ya sumados: evita doble conteo cuando hay dos versiones
      // del mismo ítem vigentes en el mismo mes (cambio de periodicidad a mitad de mes)
      const prefixContado = new Set()

      for (const item of itemsMes) {
        // Días activos reales dentro de este mes según vigencia
        const vigDesde = item.vigenciaDesde ? new Date(item.vigenciaDesde) : new Date(anio, 0, 1)
        const vigHasta = item.vigenciaHasta ? new Date(item.vigenciaHasta) : ultimoDia
        const diaInicio   = vigDesde > primerDia ? vigDesde.getDate() : 1
        const diaFin      = vigHasta < ultimoDia  ? vigHasta.getDate() : diasMes
        const diasActivos = Math.max(0, diaFin - diaInicio + 1)

        const frec = frecuenciaParcial(item.periodicidad, diasActivos, diasMes, mesIdx, item.mesInicio || 0)
        if (frec === 0) continue

        const cantUnidades = item.unidades?.length || 1
        const cantTareas   = item.tareas.length
        const planItem     = frec * cantUnidades * cantTareas
        planificado += planItem

        const byId = ejecutadoPorItemId[mes]?.[item._id.toString()] || 0

        // byPrefix solo se suma una vez por prefijo (evita doble conteo entre versiones)
        const prefixKey = (item.codigoPrefix || '').toUpperCase()
        let byPrefix = 0
        if (!prefixContado.has(prefixKey)) {
          byPrefix = prefixKey ? (ejecutadoPorPrefix[mes]?.[prefixKey] || 0) : 0
          prefixContado.add(prefixKey)
        }

        ejecutado += Math.min(byId + byPrefix, planItem)
      }

      const ejFinal = Math.min(ejecutado, planificado)
      return { mes, planificado, ejecutado: ejFinal, porcentaje: planificado > 0 ? Math.round((ejFinal / planificado) * 100) : null }
    })

    // Items vigentes para mostrar en la tabla
    const hoy = new Date()
    const itemsVigentes = items.filter(i => !i.vigenciaHasta || new Date(i.vigenciaHasta) >= hoy)

    res.json({ resultado, items: itemsVigentes, mesActual: resultado[mesActual] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── GET /plan/cumplimiento/detalle ──────────────────────────────────────────
// Desglose mensual por tipo de equipo: programado vs. realizado
router.get('/cumplimiento/detalle', authMW, async (req, res) => {
  try {
    const anio     = Number(req.query.anio) || new Date().getFullYear()
    const estacion = req.query.estacion

    const filtro = { anio, activo: true }
    if (estacion) filtro.estacion = estacion
    const items = await ItemPlan.find(filtro).lean()
    if (!items.length) return res.json({ resultado: [] })

    // Inspecciones del año filtradas por fecha de verificación
    const desde      = new Date(anio, 0, 1)
    const hasta      = new Date(anio + 1, 0, 1)
    const filtroInsp = { fecha: { $gte: desde, $lt: hasta } }
    if (estacion) filtroInsp.estacion = estacion
    const inspecciones = await Inspeccion.find(filtroInsp)
      .select('equipos tareasVerificadas fecha planItemId')
      .lean()

    // Mismos mapas que /cumplimiento
    const ejecutadoPorItemId = {}
    const ejecutadoPorPrefix = {}
    for (const insp of inspecciones) {
      const mes         = MESES[new Date(insp.fecha).getMonth()]
      const tareasCount = Math.max((insp.tareasVerificadas || []).length, 1)
      if (insp.planItemId) {
        if (!ejecutadoPorItemId[mes]) ejecutadoPorItemId[mes] = {}
        const pid   = insp.planItemId.toString()
        const units = Math.max((insp.equipos || []).length, 1)
        ejecutadoPorItemId[mes][pid] = (ejecutadoPorItemId[mes][pid] || 0) + (units * tareasCount)
      } else {
        if (!ejecutadoPorPrefix[mes]) ejecutadoPorPrefix[mes] = {}
        const unidadesPorPrefix = {}
        for (const eq of (insp.equipos || [])) {
          const prefix = (eq.codigo || '').replace(/[-\s\d].*/, '').toUpperCase()
          if (prefix) unidadesPorPrefix[prefix] = (unidadesPorPrefix[prefix] || 0) + 1
        }
        for (const [prefix, unidades] of Object.entries(unidadesPorPrefix)) {
          ejecutadoPorPrefix[mes][prefix] = (ejecutadoPorPrefix[mes][prefix] || 0) + (unidades * tareasCount)
        }
      }
    }

    const resultado = MESES.map((mes, mesIdx) => {
      const primerDia = new Date(anio, mesIdx, 1)
      const ultimoDia = new Date(anio, mesIdx + 1, 0)

      // Ítems vigentes en este mes
      const itemsMes = items.filter(item => {
        if (!(item.tareas?.length)) return false
        const vigDesde = item.vigenciaDesde ? new Date(item.vigenciaDesde) : new Date(anio, 0, 1)
        const vigHasta = item.vigenciaHasta ? new Date(item.vigenciaHasta) : null
        return vigDesde <= ultimoDia && (vigHasta === null || vigHasta >= primerDia)
      })

      const diasMes = ultimoDia.getDate()
      // Agrupar por equipo+prefix con frecuencia parcial y sin doble conteo de prefix
      const tiposDelMes   = {}
      const prefixContado = new Set()

      for (const item of itemsMes) {
        const key  = `${item.equipo}||${item.codigoPrefix || ''}`
        if (!tiposDelMes[key]) tiposDelMes[key] = { equipo: item.equipo, codigoPrefix: item.codigoPrefix || '', planificado: 0, ejecutado: 0 }
        const tipo = tiposDelMes[key]

        const vigDesde = item.vigenciaDesde ? new Date(item.vigenciaDesde) : new Date(anio, 0, 1)
        const vigHasta = item.vigenciaHasta ? new Date(item.vigenciaHasta) : ultimoDia
        const diaInicio   = vigDesde > primerDia ? vigDesde.getDate() : 1
        const diaFin      = vigHasta < ultimoDia  ? vigHasta.getDate() : diasMes
        const diasActivos = Math.max(0, diaFin - diaInicio + 1)

        const frec = frecuenciaParcial(item.periodicidad, diasActivos, diasMes, mesIdx, item.mesInicio || 0)
        if (frec === 0) continue
        const cantUnidades = item.unidades?.length || 1
        const cantTareas   = item.tareas.length
        tipo.planificado += frec * cantUnidades * cantTareas

        const byId = ejecutadoPorItemId[mes]?.[item._id.toString()] || 0
        const prefixKey = (item.codigoPrefix || '').toUpperCase()
        let byPrefix = 0
        if (!prefixContado.has(prefixKey)) {
          byPrefix = prefixKey ? (ejecutadoPorPrefix[mes]?.[prefixKey] || 0) : 0
          prefixContado.add(prefixKey)
        }
        tipo.ejecutado += byId + byPrefix
      }

      const detalle = Object.values(tiposDelMes)
        .filter(t => t.planificado > 0)
        .map(t => {
          const ejec = Math.min(t.ejecutado, t.planificado)
          return { equipo: t.equipo, codigoPrefix: t.codigoPrefix, planificado: t.planificado, ejecutado: ejec, porcentaje: Math.round((ejec / t.planificado) * 100) }
        })
        .sort((a, b) => a.equipo.localeCompare(b.equipo))

      const totalPlan = detalle.reduce((s, d) => s + d.planificado, 0)
      const totalEjec = detalle.reduce((s, d) => s + d.ejecutado, 0)

      return {
        mes, mesIdx,
        planificado: totalPlan,
        ejecutado:   totalEjec,
        porcentaje:  totalPlan > 0 ? Math.round((totalEjec / totalPlan) * 100) : null,
        detalle
      }
    })

    res.json({ resultado })
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
      const fechaDesde = new Date(aplicarDesde + 'T00:00:00')
      const mesInicio  = fechaDesde.getMonth()

      // Si el mes seleccionado coincide con el vigenciaDesde actual (o no tiene vigenciaDesde)
      // → actualizar en lugar de versionar
      const vigDesdeActual = itemActual.vigenciaDesde ? new Date(itemActual.vigenciaDesde) : null
      const mismoMes = !vigDesdeActual || (
        vigDesdeActual.getFullYear() === fechaDesde.getFullYear() &&
        vigDesdeActual.getMonth()    === fechaDesde.getMonth()
      )

      if (mismoMes) {
        itemActual.periodicidad = periodicidad
        itemActual.mesInicio    = mesInicio
        if (!vigDesdeActual) itemActual.vigenciaDesde = fechaDesde
        await itemActual.save()
        return res.json(itemActual)
      }

      // Versionar: cierra el actual y crea uno nuevo desde la fecha indicada
      const fechaHasta = new Date(fechaDesde)
      fechaHasta.setDate(fechaHasta.getDate() - 1)
      itemActual.vigenciaHasta = fechaHasta
      await itemActual.save()

      const { _id, createdAt, updatedAt, __v, ...datosBase } = itemActual.toObject()
      const nuevoItem = await ItemPlan.create({ ...datosBase, periodicidad, mesInicio, vigenciaDesde: fechaDesde, vigenciaHasta: null })
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
