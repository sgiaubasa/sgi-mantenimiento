import re

# 1. Update desvios.js
with open('backend/routes/desvios.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_pendientes = '''  try {
    const filter = { estado: 'Pendiente' }
    if (req.usuario.rol !== 'admin' && !(req.usuario.estaciones || []).includes('Todas')) {
      const allowed = req.usuario.estaciones || [];
      const inspIds = await Inspeccion.find({ estacion: { $in: allowed } }).select('_id').lean();
      filter.idInspeccionOrigen = { $in: inspIds.map(i => i._id) };
    }

    const desvios = await Desvio.find(filter)'''
content = content.replace("  try {\n    const desvios = await Desvio.find({ estado: 'Pendiente' })", new_pendientes)

new_get = '''  try {
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

    const desvios = await Desvio.find(filter)'''

content = re.sub(r'  try \{\n    const \{ estado, estacion.*?const desvios = await Desvio\.find\(filter\)', new_get, content, flags=re.DOTALL)

with open('backend/routes/desvios.js', 'w', encoding='utf-8') as f:
    f.write(content)

# 2. Update inspecciones.js
with open('backend/routes/inspecciones.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("router.get('/kpis', authMW, async (req, res) => {", "router.get('/kpis', authMW, async (req, res) => {")
content = content.replace("router.get('/', async (req, res) => {", "router.get('/', authMW, async (req, res) => {")

new_inspecciones_kpi = '''  try {
    const { desde, hasta, estacion } = req.query
    const filtro = {}

    if (req.usuario.rol !== 'admin' && !(req.usuario.estaciones || []).includes('Todas')) {
      const allowed = req.usuario.estaciones || [];
      if (estacion && !allowed.includes(estacion)) return res.json({ labels: [], cumplimiento: [], notas: [] });
      filtro.estacion = estacion ? estacion : { $in: allowed };
    } else if (estacion) {
      filtro.estacion = estacion;
    }'''
content = re.sub(r'  try \{\n    const \{ desde, hasta, estacion \} = req\.query\n    const filtro = \{\}\n    if \(estacion\) filtro\.estacion = estacion', new_inspecciones_kpi, content)

new_inspecciones_get = '''  try {
    const { desde, hasta, estacion } = req.query
    const filtro = {}

    if (req.usuario.rol !== 'admin' && !(req.usuario.estaciones || []).includes('Todas')) {
      const allowed = req.usuario.estaciones || [];
      if (estacion && !allowed.includes(estacion)) return res.json([]);
      filtro.estacion = estacion ? estacion : { $in: allowed };
    } else if (estacion) {
      filtro.estacion = estacion;
    }'''
content = re.sub(r'  try \{\n    const \{ desde, hasta, estacion \} = req\.query\n    const filtro = \{\}\n    if \(estacion\) filtro\.estacion = estacion', new_inspecciones_get, content)

with open('backend/routes/inspecciones.js', 'w', encoding='utf-8') as f:
    f.write(content)


# 3. Update plan.js
with open('backend/routes/plan.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_plan_get = '''  try {
    const { tipo, estacion, year } = req.query
    const filter = {}
    if (tipo) filter.tipo = tipo
    if (year) filter.year = Number(year)

    if (req.usuario.rol !== 'admin' && !(req.usuario.estaciones || []).includes('Todas')) {
      const allowed = req.usuario.estaciones || [];
      if (estacion && !allowed.includes(estacion)) return res.json([]);
      filter.estacion = estacion ? estacion : { $in: allowed };
    } else if (estacion) {
      filter.estacion = estacion;
    }'''
content = re.sub(r'  try \{\n    const \{ tipo, estacion, year \} = req\.query\n    const filter = \{\}\n    if \(tipo\) filter\.tipo = tipo\n    if \(estacion\) filter\.estacion = estacion\n    if \(year\) filter\.year = Number\(year\)', new_plan_get, content)

new_plan_cumplimiento = '''  try {
    const { estacion, year } = req.query
    const filter = {}
    if (year) filter.year = Number(year)

    if (req.usuario.rol !== 'admin' && !(req.usuario.estaciones || []).includes('Todas')) {
      const allowed = req.usuario.estaciones || [];
      if (estacion && !allowed.includes(estacion)) return res.json({ items: [], resultado: [] });
      filter.estacion = estacion ? estacion : { $in: allowed };
    } else if (estacion) {
      filter.estacion = estacion;
    }'''
content = re.sub(r'  try \{\n    const \{ estacion, year \} = req\.query\n    const filter = \{\}\n    if \(estacion\) filter\.estacion = estacion\n    if \(year\) filter\.year = Number\(year\)', new_plan_cumplimiento, content)

new_plan_detalle = '''  try {
    const { estacion, year } = req.query
    const filter = {}
    if (year) filter.year = Number(year)

    if (req.usuario.rol !== 'admin' && !(req.usuario.estaciones || []).includes('Todas')) {
      const allowed = req.usuario.estaciones || [];
      if (estacion && !allowed.includes(estacion)) return res.json({ resultado: [] });
      filter.estacion = estacion ? estacion : { $in: allowed };
    } else if (estacion) {
      filter.estacion = estacion;
    }'''
content = re.sub(r'  try \{\n    const \{ estacion, year \} = req\.query\n    const filter = \{\}\n    if \(estacion\) filter\.estacion = estacion\n    if \(year\) filter\.year = Number\(year\)', new_plan_detalle, content)

with open('backend/routes/plan.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Update scripts finished.")
