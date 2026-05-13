// ─── Config ──────────────────────────────────────────────────────────────────
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3002/api'
  : '/api'

// ─── Estado ──────────────────────────────────────────────────────────────────
let usuarioActual        = null
let currentFile          = null
let analisisActual       = null
let desviosCierrePosible = []
let desviosSeleccionados = new Set()
let desvioIdParaCerrar   = null
let usuarioEditandoId    = null

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function getToken()  { return localStorage.getItem('sgi_token') }
function getHeaders() {
  const h = { 'Content-Type': 'application/json' }
  const t = getToken()
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

async function apiFetch(path, options = {}) {
  const res = await fetch(API_URL + path, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers || {}) }
  })
  if (res.status === 401) { cerrarSesion(); return }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Error ${res.status}`)
  }
  return res.json()
}

async function apiFormFetch(path, formData) {
  const headers = {}
  const t = getToken()
  if (t) headers['Authorization'] = `Bearer ${t}`
  const res = await fetch(API_URL + path, { method: 'POST', headers, body: formData })
  if (res.status === 401) { cerrarSesion(); return }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Error ${res.status}`)
  }
  return res.json()
}

// ─── Notificaciones toast ────────────────────────────────────────────────────
function showNotification(msg, type = 'success') {
  const n = document.createElement('div')
  n.className = `notification ${type}`
  n.textContent = msg
  document.body.appendChild(n)
  setTimeout(() => n.classList.add('show'), 10)
  setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 400) }, 4000)
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function mostrarLogin()     { document.getElementById('login-screen').style.display = 'flex'; document.getElementById('dashboard').style.display = 'none' }
function mostrarDashboard() { document.getElementById('login-screen').style.display = 'none'; document.getElementById('dashboard').style.display = 'flex' }

document.getElementById('login-form')?.addEventListener('submit', async e => {
  e.preventDefault()
  const email    = document.getElementById('login-email').value
  const password = document.getElementById('login-password').value
  const errEl    = document.getElementById('login-error')
  const btn      = document.getElementById('btn-login')

  btn.disabled = true; btn.textContent = 'Ingresando...'
  errEl.style.display = 'none'

  try {
    const data = await fetch(API_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const res = await data.json()
    if (!data.ok) throw new Error(res.error || 'Error al ingresar')

    localStorage.setItem('sgi_token',   res.token)
    localStorage.setItem('sgi_usuario', JSON.stringify(res.usuario))
    usuarioActual = res.usuario
    iniciarDashboard()
  } catch (err) {
    errEl.textContent    = err.message
    errEl.style.display  = 'block'
  } finally {
    btn.disabled = false; btn.textContent = 'Ingresar'
  }
})

function cerrarSesion() {
  localStorage.removeItem('sgi_token')
  localStorage.removeItem('sgi_usuario')
  usuarioActual = null
  mostrarLogin()
}

document.getElementById('btn-logout')?.addEventListener('click', e => { e.preventDefault(); cerrarSesion() })

// ─── Inicializar dashboard ────────────────────────────────────────────────────
function iniciarDashboard() {
  mostrarDashboard()

  const nombre    = usuarioActual.nombre || '?'
  const iniciales = nombre.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
  document.getElementById('user-nombre').textContent = nombre
  document.getElementById('user-rol').textContent    = { admin: 'Administrador', supervisor: 'Supervisor', operador: 'Operador' }[usuarioActual.rol] || usuarioActual.rol
  document.getElementById('user-avatar').textContent = iniciales

  if (usuarioActual.rol === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex')
  }

  aplicarFiltroEstaciones()
  inicializarCharts()
  loadResumen()
}

function aplicarFiltroEstaciones() {
  if (!usuarioActual) return
  const estaciones = usuarioActual.estaciones || []
  if (estaciones.length === 0) return
  document.querySelectorAll('#estacion-manual').forEach(sel => {
    Array.from(sel.options).forEach(opt => {
      if (opt.value && !estaciones.includes(opt.value)) opt.remove()
    })
  })
}

// ─── Navegación ───────────────────────────────────────────────────────────────
const navItems     = document.querySelectorAll('.nav-item[data-target]')
const viewSections = document.querySelectorAll('.view-section')
const pageTitle    = document.getElementById('dynamic-title')
const pageSubtitle = document.getElementById('dynamic-subtitle')

const viewMeta = {
  'view-resumen': {
    title: 'Indicadores del Sistema de Gestión Integrado',
    subtitle: 'Monitoreo en tiempo real · Normas ISO 9001 e ISO 39001',
    onEnter: () => loadResumen()
  },
  'view-mantenimiento': {
    title: 'Plan de Mantenimiento Preventivo',
    subtitle: 'Análisis automático con IA · Gestión de desvíos (Anexo 3.3)',
    onEnter: () => { loadKpis(); loadCumplimiento() }
  },
  'view-repositorio': {
    title: 'Repositorio de Verificaciones',
    subtitle: 'Historial de inspecciones con evidencia para auditoría',
    onEnter: () => loadRepositorio()
  },
  'view-desvios': {
    title: 'Desvíos Pendientes',
    subtitle: 'Bandeja de gestión y cierre de desvíos abiertos',
    onEnter: () => { loadDesviosPendientes(); initMesesSelect('hist-mes-desde','hist-mes-hasta'); loadHistorialDesvios() }
  },
  'view-usuarios': {
    title: 'Gestión de Usuarios',
    subtitle: 'Alta, baja y modificación de usuarios del sistema',
    onEnter: () => loadUsuarios()
  }
}

navItems.forEach(item => {
  item.addEventListener('click', e => {
    const targetId = item.getAttribute('data-target')
    e.preventDefault()
    navItems.forEach(n => n.classList.remove('active'))
    item.classList.add('active')
    viewSections.forEach(v => { v.classList.remove('active'); v.style.display = 'none' })
    const target = document.getElementById(targetId)
    if (!target) return
    target.style.display = 'block'
    setTimeout(() => target.classList.add('active'), 10)
    const meta = viewMeta[targetId]
    if (meta) { pageTitle.textContent = meta.title; pageSubtitle.textContent = meta.subtitle; meta.onEnter?.() }
  })
})

// ─── KPIs ─────────────────────────────────────────────────────────────────────
// Helper: inicializa dos selects de mes (desde/hasta) para el año actual
function initMesesSelect(desdeId, hastaId) {
  const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const anio = new Date().getFullYear()
  const mesActual = new Date().getMonth()
  const fromSel = document.getElementById(desdeId)
  const toSel   = document.getElementById(hastaId)
  if (!fromSel || !toSel) return
  // Solo inicializar si están vacíos
  if (fromSel.options.length) return
  for (let m = 0; m < 12; m++) {
    const val = `${anio}-${String(m + 1).padStart(2, '0')}`
    const lbl = `${MESES_SHORT[m]} ${anio}`
    fromSel.innerHTML += `<option value="${val}"${m === 0 ? ' selected' : ''}>${lbl}</option>`
    toSel.innerHTML   += `<option value="${val}"${m === mesActual ? ' selected' : ''}>${lbl}</option>`
  }
}

async function loadKpis(estacion = '', desde = '', hasta = '') {
  try {
    const params = new URLSearchParams()
    if (estacion) params.append('estacion', estacion)
    if (desde)    params.append('desde',    desde)
    if (hasta)    params.append('hasta',    hasta)
    const d = await apiFetch('/inspecciones/kpis?' + params)
    if (!d) return

    setText('kpi-resumen-total',        d.totalMes)
    setText('kpi-total',                d.totalMes)
    setText('kpi-pendientes',           d.pendientes)
    setText('kpi-cerrados',             d.cerradosMes)
    setText('kpi-desvios-abiertos',     d.pendientes)
    setText('kpi-desvios-cerrados-mes', d.cerradosMes)

    if (d.disponibilidad !== null && d.itemsTotal > 0) {
      setText('kpi-disponibilidad',     d.disponibilidad)
      setText('kpi-disponibilidad-sub', `${d.itemsConformes} conformes de ${d.itemsTotal} verificados`)
      colorearTrend('kpi-disponibilidad', d.disponibilidad, 85)
    }

    if (d.eficaciaDesvios !== null && d.desviosDetectadosMes > 0) {
      setText('kpi-eficacia',     d.eficaciaDesvios)
      setText('kpi-eficacia-sub', `${d.cerradosMes} cerrados de ${d.desviosDetectadosMes} detectados`)
      colorearTrend('kpi-eficacia', d.eficaciaDesvios, 75)
    }

    const sub = document.getElementById('kpi-resumen-total-sub')
    if (sub) sub.textContent = d.conFallasMes > 0 ? `${d.conFallasMes} con fallas detectadas` : 'Sin fallas este mes ✓'

    // badge de desvíos pendientes en el nav
    const badge = document.getElementById('badge-pendientes')
    if (badge) { badge.textContent = d.pendientes; badge.style.display = d.pendientes > 0 ? 'inline-flex' : 'none' }
  } catch (_) {}
}

// Calcula el cumplimiento PMP para el rango seleccionado y actualiza el gauge
async function loadGaugePMP(estacion = '', desde = '', hasta = '') {
  const anio = new Date().getFullYear()
  try {
    const params = new URLSearchParams({ anio })
    if (estacion) params.append('estacion', estacion)
    const { resultado } = await apiFetch('/plan/cumplimiento?' + params)
    if (!resultado?.length) { updateGauge(null); return }

    const MESES_IDX = { enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,
      julio:6,agosto:7,septiembre:8,octubre:9,noviembre:10,diciembre:11 }
    const desdeIdx = desde ? Number(desde.split('-')[1]) - 1 : 0
    const hastaIdx = hasta ? Number(hasta.split('-')[1]) - 1 : new Date().getMonth()

    let totalPlan = 0, totalEjec = 0
    for (const r of resultado) {
      const idx = MESES_IDX[r.mes] ?? -1
      if (idx >= desdeIdx && idx <= hastaIdx) {
        totalPlan += r.planificado || 0
        totalEjec += r.ejecutado   || 0
      }
    }
    updateGauge(totalPlan > 0 ? Math.round((totalEjec / totalPlan) * 100) : null)
  } catch (_) { updateGauge(null) }
}

// Coordinador del Resumen: aplica todos los filtros en paralelo
async function loadResumen() {
  initMesesSelect('resumen-mes-desde', 'resumen-mes-hasta')
  const estacion = document.getElementById('resumen-estacion')?.value || ''
  const desde    = document.getElementById('resumen-mes-desde')?.value || ''
  const hasta    = document.getElementById('resumen-mes-hasta')?.value || ''

  // Etiqueta del período
  const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const label = document.getElementById('resumen-rango-label')
  if (label && desde && hasta) {
    const dm = Number(desde.split('-')[1]) - 1
    const hm = Number(hasta.split('-')[1]) - 1
    label.textContent = dm === hm ? MESES_SHORT[dm] : `${MESES_SHORT[dm]} → ${MESES_SHORT[hm]}`
  }

  await Promise.all([
    loadKpis(estacion, desde, hasta),
    loadGaugePMP(estacion, desde, hasta)
  ])
  loadBarPMP()
}

// Historial de desvíos con filtros
async function loadHistorialDesvios() {
  const lista = document.getElementById('historial-desvios-lista')
  if (!lista) return
  lista.innerHTML = '<p class="empty-state">Cargando...</p>'

  const estacion = document.getElementById('hist-estacion')?.value || ''
  const estado   = document.getElementById('hist-estado')?.value   || ''
  const desde    = document.getElementById('hist-mes-desde')?.value || ''
  const hasta    = document.getElementById('hist-mes-hasta')?.value || ''

  const params = new URLSearchParams()
  if (estado)   params.append('estado',   estado)
  if (estacion) params.append('estacion', estacion)
  if (desde)    params.append('desde',    desde)
  if (hasta)    params.append('hasta',    hasta)

  try {
    const desvios = await apiFetch('/desvios?' + params)
    if (!desvios?.length) {
      lista.innerHTML = '<div class="empty-state-card"><span style="font-size:2rem">✓</span><p>No hay desvíos con los filtros seleccionados.</p></div>'
      return
    }
    lista.innerHTML = `<div style="overflow-x:auto"><table class="tabla-plan" style="width:100%">
      <thead><tr>
        <th>Fecha</th><th>Estación</th><th>Equipo</th>
        <th>Desvío detectado</th><th>Acción implementar</th>
        <th style="text-align:center">Estado</th><th>Cierre / Eficacia</th>
      </tr></thead>
      <tbody>${desvios.map(d => {
        const fecha  = new Date(d.createdAt).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
        const est    = d.idInspeccionOrigen?.estacion || '—'
        const equipo = [d.codigoEquipo, d.descripcionEquipo].filter(Boolean).join(' · ')
        const badge  = d.estado === 'Cerrado'
          ? `<span style="background:#DCFCE7;color:#16A34A;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">Cerrado</span>`
          : `<span style="background:#FEF3C7;color:#D97706;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">Pendiente</span>`
        const cierre = d.fechaRealCierre
          ? new Date(d.fechaRealCierre).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' }) + (d.eficacia ? ` — ${d.eficacia}` : '')
          : '—'
        return `<tr>
          <td style="white-space:nowrap;font-size:12px">${fecha}</td>
          <td style="font-size:12px">${est}</td>
          <td style="font-size:12px;font-weight:500">${escHtml(equipo)}</td>
          <td style="font-size:12px;color:var(--danger-color)">${escHtml(d.observacionFalla || d.descripcionDesvio || '—')}</td>
          <td style="font-size:12px">${escHtml(d.accionImplementar || '—')}</td>
          <td style="text-align:center">${badge}</td>
          <td style="font-size:12px;white-space:nowrap">${cierre}</td>
        </tr>`
      }).join('')}</tbody>
    </table></div>`
  } catch (err) {
    lista.innerHTML = `<p class="empty-state" style="color:var(--danger-color)">Error: ${err.message}</p>`
  }
}

function setText(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = (val !== null && val !== undefined) ? val : '—'
}

function colorearTrend(kpiId, valor, umbral) {
  const card = document.getElementById(kpiId)?.closest('.kpi-card')
  if (!card) return
  const trend = card.querySelector('.trend')
  if (!trend) return
  trend.className = 'trend ' + (valor >= umbral ? 'positive' : valor >= umbral * 0.7 ? 'neutral' : 'negative')
}

// ─── Charts ───────────────────────────────────────────────────────────────────
let gaugeChart
let barChart

function inicializarCharts() {
  if (gaugeChart) return
  Chart.defaults.font.family = "'Inter', sans-serif"
  Chart.defaults.color = '#A3AED0'

  const gaugeCtx = document.getElementById('gaugeChart')?.getContext('2d')
  if (!gaugeCtx) return

  gaugeChart = new Chart(gaugeCtx, {
    type: 'doughnut',
    data: {
      labels: ['Conforme', 'Con fallas'],
      datasets: [{ data: [0, 100], backgroundColor: ['#4318FF', '#F4F7FE'], borderWidth: 0, borderRadius: [20, 0], cutout: '80%' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      rotation: 270, circumference: 180,
      plugins: { legend: { display: false }, tooltip: { enabled: false } }
    }
  })

  const barCtx = document.getElementById('barChart')?.getContext('2d')
  if (!barCtx) return

  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: MESES_LABEL,
      datasets: [
        { label: 'Planificado', data: Array(12).fill(0), backgroundColor: 'rgba(67,24,255,0.18)', borderColor: '#4318FF', borderWidth: 2, borderRadius: 6, barPercentage: 0.55, categoryPercentage: 0.8 },
        { label: 'Ejecutado',   data: Array(12).fill(0), backgroundColor: '#4318FF', borderRadius: 6, barPercentage: 0.55, categoryPercentage: 0.8 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', align: 'end' },
        tooltip: { backgroundColor: '#1B2559', cornerRadius: 8, callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}`
        }}
      },
      scales: {
        y: { beginAtZero: true, border: { display: false }, ticks: { precision: 0 } },
        x: { border: { display: false }, grid: { display: false } }
      }
    }
  })

  loadBarPMP()
}

async function loadBarPMP() {
  if (!barChart) return
  try {
    const anio     = new Date().getFullYear()
    const estacion = document.getElementById('resumen-estacion')?.value || ''
    const params   = new URLSearchParams({ anio })
    if (estacion) params.append('estacion', estacion)
    const { resultado } = await apiFetch('/plan/cumplimiento?' + params)
    if (!resultado) return

    barChart.data.datasets[0].data = resultado.map(r => r.planificado || 0)
    barChart.data.datasets[1].data = resultado.map(r => r.ejecutado  || 0)
    barChart.update()

    const label = document.getElementById('bar-pmp-label')
    if (label) label.textContent = `${anio}${estacion ? ' · ' + estacion : ''}`
  } catch { /* silencioso si no hay plan */ }
}

function updateGauge(pct) {
  if (!gaugeChart || pct === null) return
  gaugeChart.data.datasets[0].data = [pct, 100 - pct]
  gaugeChart.update()
  const el = document.getElementById('gauge-pct')
  if (el) el.textContent = pct + '%'
}

// ─── Proveedor Externo show/hide ──────────────────────────────────────────────
document.getElementById('tipo-verificacion')?.addEventListener('change', function () {
  const grupo = document.getElementById('grupo-proveedor')
  if (grupo) grupo.style.display = this.value === 'Proveedor Externo' ? 'block' : 'none'
})

// ─── File input visual ────────────────────────────────────────────────────────
const fileInput      = document.getElementById('archivo')
const fileVisualText = document.getElementById('file-visual-text')

if (fileInput) {
  fileInput.addEventListener('change', e => {
    currentFile = e.target.files[0] || null
    if (currentFile) { fileVisualText.textContent = currentFile.name; fileVisualText.style.color = 'var(--success-color)' }
    else resetFileVisual()
  })
}
function resetFileVisual() {
  if (fileVisualText) { fileVisualText.textContent = 'Subir PDF o imagen del Anexo 3.6'; fileVisualText.style.color = 'var(--primary-color)' }
}

// ─── PASO 1: Análisis con IA ──────────────────────────────────────────────────
document.getElementById('analizar-form')?.addEventListener('submit', async e => {
  e.preventDefault()
  if (!currentFile) { showNotification('Seleccioná un archivo PDF o imagen.', 'error'); return }
  setBtnLoading(true)
  const fd = new FormData()
  fd.append('archivo', currentFile)
  try {
    const { analisis, desviosCierrePosible: desvios } = await apiFormFetch('/inspecciones/analizar', fd)
    analisisActual       = analisis
    desviosCierrePosible = desvios || []
    desviosSeleccionados = new Set()
    mostrarResultados()
  } catch (err) {
    showNotification('Error en análisis: ' + err.message, 'error')
  } finally {
    setBtnLoading(false)
  }
})

function setBtnLoading(loading) {
  const btn  = document.getElementById('btn-analizar')
  const text = document.getElementById('btn-analizar-text')
  const icon = document.getElementById('btn-analizar-icon')
  if (!btn) return
  btn.disabled     = loading
  text.textContent = loading ? 'Analizando...' : 'Analizar con IA'
  icon.innerHTML   = loading
    ? '<div class="spinner"></div>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
}

// ─── PASO 2: Mostrar resultados del análisis ──────────────────────────────────
function mostrarResultados() {
  const equipos   = analisisActual?.equipos || []
  const fallas    = equipos.filter(e => e.estado === 'falla')
  const correctos = equipos.filter(e => e.estado === 'correcto')

  const meta = []
  if (analisisActual.estacion) meta.push(`📍 ${analisisActual.estacion}`)
  if (analisisActual.fecha)    meta.push(`📅 ${formatDate(analisisActual.fecha)}`)
  if (analisisActual.operador) meta.push(`👤 ${analisisActual.operador}`)
  document.getElementById('resultado-meta').innerHTML = meta.length
    ? `<span class="meta-chips">${meta.map(m => `<span class="meta-chip">${m}</span>`).join('')}</span>` : ''

  const badge = document.getElementById('resultado-badge')
  if (fallas.length === 0) {
    badge.className   = 'resultado-badge badge-ok'
    badge.textContent = `✓ ${correctos.length} ítems conformes`
  } else {
    badge.className   = 'resultado-badge badge-falla'
    badge.textContent = `⚠ ${fallas.length} falla${fallas.length > 1 ? 's' : ''} detectada${fallas.length > 1 ? 's' : ''}`
  }

  document.getElementById('equipos-resultado').innerHTML = equipos.length
    ? equipos.map(eq => renderEquipoCard(eq)).join('')
    : '<p class="empty-state">No se detectaron equipos. Verificá que la imagen sea legible.</p>'

  const panelAuto = document.getElementById('panel-autoclose')
  if (desviosCierrePosible.length > 0) {
    panelAuto.style.display = 'block'
    document.getElementById('autoclose-lista').innerHTML = desviosCierrePosible.map(d => `
      <label class="autoclose-item">
        <input type="checkbox" class="autoclose-check" data-id="${d._id}" onchange="toggleAutoclose('${d._id}', this.checked)">
        <div>
          <span class="equipo-badge badge-ok-small">${d.codigoEquipo}</span>
          <strong>${d.descripcionEquipo || ''}</strong>
          <span class="autoclose-falla">Falla previa: ${d.observacionFalla || d.descripcionDesvio || '—'}</span>
        </div>
      </label>`).join('')
  } else {
    panelAuto.style.display = 'none'
  }

  const panelDesvios = document.getElementById('panel-desvios-nuevos')
  if (fallas.length > 0) {
    panelDesvios.style.display = 'block'
    document.getElementById('desvios-nuevos-container').innerHTML = fallas.map((eq, i) => renderDesvioForm(eq, i)).join('')
    document.querySelectorAll('.desvio-field').forEach(el => el.addEventListener('input', checkConfirmarEnabled))
  } else {
    panelDesvios.style.display = 'none'
  }

  document.getElementById('panel-upload').style.display     = 'none'
  document.getElementById('panel-resultados').style.display = 'block'
  checkConfirmarEnabled()
}

function renderEquipoCard(eq) {
  const ok = eq.estado === 'correcto'
  return `<div class="equipo-card ${ok ? 'equipo-ok' : 'equipo-falla'}">
    <div class="equipo-card-header">
      <span class="equipo-codigo">${eq.codigo || '—'}</span>
      <span class="equipo-estado-badge ${ok ? 'badge-correcto' : 'badge-falla-sm'}">${ok ? '✓ Correcto' : '✗ Falla'}</span>
    </div>
    <p class="equipo-desc">${eq.descripcion || ''}</p>
    ${eq.observacion ? `<p class="equipo-obs">⚠ ${eq.observacion}</p>` : ''}
  </div>`
}

function renderDesvioForm(eq, i) {
  return `<div class="desvio-form-card">
    <div class="desvio-form-title">
      <span class="equipo-codigo">${eq.codigo}</span>
      <span>${eq.descripcion || ''}</span>
      ${eq.observacion ? `<span class="equipo-obs-small">IA: "${eq.observacion}"</span>` : ''}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Descripción del desvío *</label>
        <textarea class="desvio-field" id="desvio-desc-${i}" rows="2" required placeholder="Describí el problema..."
          data-codigo="${eq.codigo}" data-desc="${eq.descripcion || ''}" data-obs="${eq.observacion || ''}"></textarea>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Acción a implementar *</label>
        <input class="desvio-field" id="desvio-accion-${i}" type="text" required placeholder="Acción correctiva">
      </div>
      <div class="form-group">
        <label>Fecha estimada de ejecución *</label>
        <input class="desvio-field" id="desvio-fecha-${i}" type="date" required>
      </div>
    </div>
  </div>`
}

function checkConfirmarEnabled() {
  const fallas = (analisisActual?.equipos || []).filter(e => e.estado === 'falla')
  const ok = fallas.every((_, i) => {
    const desc   = document.getElementById(`desvio-desc-${i}`)?.value?.trim()
    const accion = document.getElementById(`desvio-accion-${i}`)?.value?.trim()
    const fecha  = document.getElementById(`desvio-fecha-${i}`)?.value
    return desc && accion && fecha
  })
  const btn = document.getElementById('btn-confirmar-guardar')
  if (btn) btn.disabled = !ok
}

function toggleAutoclose(id, checked) {
  if (checked) desviosSeleccionados.add(id)
  else         desviosSeleccionados.delete(id)
}

// ─── PASO 3: Guardar inspección ───────────────────────────────────────────────
document.getElementById('btn-confirmar-guardar')?.addEventListener('click', async () => {
  const fallas        = (analisisActual?.equipos || []).filter(e => e.estado === 'falla')
  const desviosNuevos = fallas.map((eq, i) => ({
    codigoEquipo:           eq.codigo,
    descripcionEquipo:      eq.descripcion || '',
    observacionFalla:       eq.observacion  || '',
    descripcionDesvio:      document.getElementById(`desvio-desc-${i}`).value,
    accionImplementar:      document.getElementById(`desvio-accion-${i}`).value,
    fechaEstimadaEjecucion: document.getElementById(`desvio-fecha-${i}`).value
  }))

  const tipoVerif = document.getElementById('tipo-verificacion')?.value || 'Personal AUBASA'
  const nomProv   = document.getElementById('nombre-proveedor')?.value  || ''

  const fd = new FormData()
  fd.append('archivo', currentFile)
  fd.append('datos', JSON.stringify({
    analisis:         analisisActual,
    estacion:         document.getElementById('estacion-manual').value,
    tipoVerificacion: tipoVerif,
    proveedorExterno: tipoVerif === 'Proveedor Externo' ? nomProv : null,
    desviosNuevos,
    desviosCerrar:    [...desviosSeleccionados]
  }))

  const btn = document.getElementById('btn-confirmar-guardar')
  btn.disabled = true; btn.textContent = 'Guardando...'

  try {
    const result = await apiFormFetch('/inspecciones', fd)
    const msgs = ['Inspección guardada correctamente.']
    if (result?.desviosCreados?.length)  msgs.push(`${result.desviosCreados.length} desvío(s) registrado(s).`)
    if (result?.desviosCerrados?.length) msgs.push(`${result.desviosCerrados.length} desvío(s) cerrado(s) automáticamente.`)
    showNotification(msgs.join(' '), 'success')
    resetFlujoAnalisis()
    loadKpis()
  } catch (err) {
    showNotification('Error al guardar: ' + err.message, 'error')
    btn.disabled = false; btn.textContent = 'Confirmar y Guardar'
  }
})

document.getElementById('btn-cancelar-analisis')?.addEventListener('click', resetFlujoAnalisis)

function resetFlujoAnalisis() {
  currentFile = null; analisisActual = null; desviosCierrePosible = []; desviosSeleccionados = new Set()
  document.getElementById('analizar-form')?.reset()
  document.getElementById('tipo-verificacion').value = 'Personal AUBASA'
  document.getElementById('grupo-proveedor').style.display = 'none'
  resetFileVisual()
  document.getElementById('panel-upload').style.display     = 'block'
  document.getElementById('panel-resultados').style.display = 'none'
  const btn = document.getElementById('btn-confirmar-guardar')
  if (btn) { btn.disabled = true; btn.textContent = 'Confirmar y Guardar' }
}

// ─── Desvíos Pendientes ───────────────────────────────────────────────────────
async function loadDesviosPendientes() {
  const lista = document.getElementById('desvios-lista')
  lista.innerHTML = '<p class="empty-state">Cargando...</p>'
  try {
    const desvios = await apiFetch('/desvios/pendientes')
    setText('kpi-desvios-abiertos', desvios?.length ?? '—')
    if (!desvios?.length) {
      lista.innerHTML = `<div class="empty-state-card"><span style="font-size:2rem">✓</span><p>No hay desvíos pendientes.</p></div>`
      return
    }
    lista.innerHTML = desvios.map(d => `
      <div class="desvio-card">
        <div class="desvio-card-header">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="equipo-codigo">${d.codigoEquipo}</span>
            <strong>${d.descripcionEquipo || ''}</strong>
          </div>
          <span class="badge-pendiente">PENDIENTE</span>
        </div>
        <div class="desvio-card-body">
          <div class="desvio-dato"><span>Falla detectada</span><p>${d.observacionFalla || '—'}</p></div>
          <div class="desvio-dato"><span>Desvío</span><p>${d.descripcionDesvio}</p></div>
          <div class="desvio-dato"><span>Acción planificada</span><p>${d.accionImplementar}</p></div>
          <div class="desvio-dato"><span>Fecha estimada</span><p>${formatDate(d.fechaEstimadaEjecucion)}</p></div>
          <div class="desvio-dato"><span>Origen</span><p>${d.idInspeccionOrigen?.estacion || '—'} · ${formatDate(d.idInspeccionOrigen?.fecha)}</p></div>
        </div>
        <div class="desvio-card-footer">
          <button class="btn-primary btn-sm" onclick="abrirModalCierre('${d._id}','${d.codigoEquipo}','${escHtml(d.descripcionEquipo)}','${escHtml(d.descripcionDesvio)}')">
            Registrar Cierre
          </button>
        </div>
      </div>`).join('')
  } catch (err) {
    lista.innerHTML = `<p class="empty-state" style="color:var(--danger-color)">Error: ${err.message}</p>`
  }
}

function abrirModalCierre(id, codigo, descripcionEquipo, descripcionDesvio) {
  desvioIdParaCerrar = id
  document.getElementById('modal-desvio-info').innerHTML = `
    <p><strong>${codigo}</strong>${descripcionEquipo ? ' — ' + descripcionEquipo : ''}</p>
    <p style="color:var(--text-secondary);margin-top:4px;font-size:13px">${descripcionDesvio}</p>`
  document.getElementById('fecha-cierre-real').value = new Date().toISOString().split('T')[0]
  document.getElementById('eficacia-select').value   = ''
  document.getElementById('modal-cerrar-desvio').style.display = 'flex'
}

document.getElementById('btn-cancelar-cierre')?.addEventListener('click', () => {
  document.getElementById('modal-cerrar-desvio').style.display = 'none'
})

document.getElementById('form-cerrar-desvio')?.addEventListener('submit', async e => {
  e.preventDefault()
  const eficacia = document.getElementById('eficacia-select').value
  if (!eficacia) { showNotification('Seleccioná la eficacia.', 'error'); return }
  try {
    await apiFetch(`/desvios/${desvioIdParaCerrar}/cerrar`, {
      method: 'PUT',
      body: JSON.stringify({ fechaRealCierre: document.getElementById('fecha-cierre-real').value, eficacia })
    })
    showNotification('Desvío cerrado exitosamente.')
    document.getElementById('modal-cerrar-desvio').style.display = 'none'
    loadDesviosPendientes(); loadKpis()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
})

// ─── Usuarios ─────────────────────────────────────────────────────────────────
async function loadUsuarios() {
  const lista = document.getElementById('usuarios-lista')
  lista.innerHTML = '<p class="empty-state">Cargando...</p>'
  try {
    const usuarios = await apiFetch('/usuarios')
    if (!usuarios?.length) { lista.innerHTML = '<p class="empty-state">No hay usuarios.</p>'; return }
    const roles = { admin: 'Administrador', supervisor: 'Supervisor', operador: 'Operador' }
    lista.innerHTML = `
      <table class="tabla-usuarios">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estaciones</th><th>Estado</th><th></th></tr></thead>
        <tbody>${usuarios.map(u => `
          <tr class="${!u.activo ? 'usuario-inactivo' : ''}">
            <td><strong>${u.nombre}</strong></td>
            <td>${u.email}</td>
            <td><span class="rol-badge rol-${u.rol}">${roles[u.rol] || u.rol}</span></td>
            <td>${u.estaciones?.length ? u.estaciones.join(', ') : 'Todas'}</td>
            <td><span class="${u.activo ? 'badge-activo' : 'badge-inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td><button class="btn-secondary btn-sm" onclick="editarUsuario('${u._id}','${escHtml(u.nombre)}','${u.email}','${u.rol}',${JSON.stringify(u.estaciones||[])},${u.activo})">Editar</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`
  } catch (err) { lista.innerHTML = `<p class="empty-state" style="color:var(--danger-color)">${err.message}</p>` }
}

function abrirModalUsuario() {
  usuarioEditandoId = null
  document.getElementById('modal-usuario-titulo').textContent = 'Nuevo Usuario'
  document.getElementById('form-usuario').reset()
  document.getElementById('usuario-id').value = ''
  document.getElementById('pass-hint').style.display = 'none'
  document.querySelectorAll('#estaciones-check input').forEach(c => c.checked = false)
  document.getElementById('modal-usuario').style.display = 'flex'
}

function editarUsuario(id, nombre, email, rol, estaciones, activo) {
  usuarioEditandoId = id
  document.getElementById('modal-usuario-titulo').textContent = 'Editar Usuario'
  document.getElementById('usuario-id').value  = id
  document.getElementById('u-nombre').value    = nombre
  document.getElementById('u-email').value     = email
  document.getElementById('u-rol').value       = rol
  document.getElementById('u-password').value  = ''
  document.getElementById('pass-hint').style.display = 'inline'
  document.querySelectorAll('#estaciones-check input').forEach(c => { c.checked = estaciones.includes(c.value) })
  document.getElementById('modal-usuario').style.display = 'flex'
}

function cerrarModalUsuario() {
  document.getElementById('modal-usuario').style.display = 'none'
}

document.getElementById('form-usuario')?.addEventListener('submit', async e => {
  e.preventDefault()
  const estaciones = Array.from(document.querySelectorAll('#estaciones-check input:checked')).map(c => c.value)
  const body = {
    nombre:     document.getElementById('u-nombre').value,
    email:      document.getElementById('u-email').value,
    rol:        document.getElementById('u-rol').value,
    estaciones
  }
  const pass = document.getElementById('u-password').value
  if (pass) body.password = pass

  try {
    if (usuarioEditandoId) {
      await apiFetch(`/usuarios/${usuarioEditandoId}`, { method: 'PUT', body: JSON.stringify(body) })
      showNotification('Usuario actualizado.')
    } else {
      if (!pass) { showNotification('La contraseña es requerida para usuarios nuevos.', 'error'); return }
      await apiFetch('/usuarios', { method: 'POST', body: JSON.stringify(body) })
      showNotification('Usuario creado exitosamente.')
    }
    cerrarModalUsuario()
    loadUsuarios()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
})

// ─── Plan de Mantenimiento ────────────────────────────────────────────────────
const MESES_ES    = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const MESES_LABEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const RESP_LABEL  = {
  SUP:'Supervisor', MAA:'Mtto. AA', MAE:'Personal', MAN:'Personal Aubasa',
  MVI:'Personal', MED:'Personal', ELE:'Electricista', JES:'Jefe Estación', TG:'Tareas Generales', PEX:'Prov. Externo'
}
const PERIOD_LABEL = {
  diario:'Diario', semanal:'Semanal', quincenal:'Quincenal', mensual:'Mensual',
  trimestral:'Trimestral', semestral:'Semestral', anual:'Anual'
}
const PERIOD_COLOR = {
  diario:'#6366F1', semanal:'#0EA5E9', quincenal:'#10B981', mensual:'#F59E0B',
  trimestral:'#EF4444', semestral:'#8B5CF6', anual:'#64748B'
}

async function loadCumplimiento() {
  const contenedor = document.getElementById('tabla-plan-excel')
  if (!contenedor) return
  contenedor.innerHTML = '<p class="empty-state">Cargando...</p>'
  try {
    const anio     = document.getElementById('plan-anio')?.value     || new Date().getFullYear()
    const estacion = document.getElementById('plan-estacion')?.value || ''
    const params   = new URLSearchParams({ anio })
    if (estacion) params.append('estacion', estacion)

    const { resultado, items, mesActual } = await apiFetch('/plan/cumplimiento?' + params)

    if (mesActual?.porcentaje != null) updateGauge(mesActual.porcentaje)

    if (!items?.length) {
      contenedor.innerHTML = `<div class="empty-state-card">
        <span style="font-size:2rem">📋</span>
        <p>No hay equipos en el plan para ${anio}${estacion ? ' · ' + estacion : ''}.</p>
        ${usuarioActual?.rol === 'admin' ? '<p style="color:var(--primary-color);font-size:13px;margin-top:4px">Usá "+ Agregar Equipo" para cargar el plan.</p>' : ''}
      </div>`
      document.getElementById('panel-cumplimiento-mensual').style.display = 'none'
      return
    }

    // Cache de items por ID para el modal de edición
    window._planItemsCache = {}
    for (const item of items) window._planItemsCache[item._id] = item

    // Tarjetas por grupo de equipo
    let html = '<div class="plan-cards-grid">'
    for (const item of items) {
      const resp = item.responsable === 'PEX' && item.proveedorExterno
        ? item.proveedorExterno
        : (RESP_LABEL[item.responsable] || item.responsable)
      const pColor = PERIOD_COLOR[item.periodicidad] || '#64748B'
      const tareas = item.tareas || []
      const unidades = item.unidades || []

      // Ítem sin tareas = dato viejo de prueba → mostrar advertencia y no sumar al plan
      if (!tareas.length) {
        html += `<div class="plan-card" style="border:2px dashed #F79009;background:#FFFBEB">
          <div class="plan-card-header">
            <div>
              <span class="plan-equipo-nombre" style="color:#92400E">${item.equipo || 'Ítem sin nombre'}</span>
              <span style="font-size:11px;color:#F79009;font-weight:600;margin-left:8px">⚠ Sin ítems configurados</span>
            </div>
            <div style="display:flex;gap:8px">
              ${usuarioActual?.rol === 'admin' ? `
                <button class="btn-icon-sm" style="color:var(--primary-color)" onclick="abrirModalEditarPeriod('${item._id}')" title="Configurar ítems">✏</button>
                <button class="btn-icon-sm" style="color:var(--danger-color)" onclick="eliminarItemPlan('${item._id}')" title="Eliminar">✕</button>
              ` : ''}
            </div>
          </div>
          <p style="font-size:12px;color:#92400E;margin:6px 0 0;line-height:1.4">Este ítem no tiene tareas configuradas y <strong>no afecta el cálculo de cumplimiento</strong>. Editalo para agregar tareas o eliminalo.</p>
        </div>`
        continue
      }

      // Tabla de matriz si hay unidades
      let matrizHTML = ''
      if (unidades.length && tareas.length) {
        matrizHTML = `<div style="overflow-x:auto;margin-top:10px">
          <table class="tabla-matriz-plan">
            <thead><tr>
              <th class="col-unidad">Unidad</th>
              ${tareas.map(t => `<th class="col-tarea-mat">${t}</th>`).join('')}
            </tr></thead>
            <tbody>${unidades.map(u => `
              <tr>
                <td class="col-unidad"><strong>${u}</strong></td>
                ${tareas.map(() => `<td class="col-tarea-mat" style="text-align:center;color:var(--text-secondary);font-size:12px">—</td>`).join('')}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`
      } else if (tareas.length) {
        matrizHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
          ${tareas.map(t => `<span class="tarea-chip">${t}</span>`).join('')}
        </div>`
      }

      html += `<div class="plan-card">
        <div class="plan-card-header">
          <div>
            <span class="plan-equipo-nombre">${item.equipo}</span>
            ${item.codigoPrefix ? `<span class="plan-codigo-badge">${item.codigoPrefix}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="period-badge" style="background:${pColor}15;color:${pColor};border:1px solid ${pColor}40">${PERIOD_LABEL[item.periodicidad]||item.periodicidad}</span>
            ${usuarioActual?.rol === 'admin' ? `
              <button class="btn-icon-sm" style="color:var(--primary-color)" onclick="abrirModalEditarPeriod('${item._id}')" title="Editar equipo">✏</button>
              <button class="btn-icon-sm" style="color:var(--danger-color)" onclick="eliminarItemPlan('${item._id}')" title="Eliminar equipo">✕</button>
            ` : ''}
          </div>
        </div>
        <div class="plan-card-meta">
          <span title="Responsable">👤 ${resp}</span>
          ${unidades.length ? `<span title="Unidades individuales">🔢 ${unidades.length} unidad${unidades.length > 1 ? 'es' : ''}</span>` : ''}
          <span title="Ítems a verificar">✅ ${tareas.length} ítem${tareas.length !== 1 ? 's' : ''}</span>
        </div>
        ${matrizHTML}
      </div>`
    }
    html += '</div>'
    contenedor.innerHTML = html

    // Cumplimiento mensual
    const panelMensual = document.getElementById('panel-cumplimiento-mensual')
    const tablaCump    = document.getElementById('tabla-cumplimiento')
    if (resultado?.some(r => r.planificado > 0)) {
      panelMensual.style.display = 'block'
      const mesActualNombre = MESES_ES[new Date().getMonth()]
      tablaCump.innerHTML = `<table class="tabla-plan">
        <thead><tr><th>Mes</th><th style="text-align:center">Ítems planificados</th><th style="text-align:center">Ítems ejecutados</th><th style="text-align:center">%</th></tr></thead>
        <tbody>${resultado.map((r, i) => {
          const esMes = r.mes === mesActualNombre
          const pct   = r.planificado > 0 ? r.porcentaje : null
          const color = pct == null ? '' : pct >= 85 ? 'var(--success-color)' : pct >= 60 ? '#F79009' : 'var(--danger-color)'
          return `<tr class="${esMes ? 'row-mes-actual' : ''}">
            <td style="font-weight:${esMes?'600':'400'};text-transform:capitalize">${MESES_LABEL[i]}${esMes?' ◀':''}</td>
            <td style="text-align:center">${r.planificado||'—'}</td>
            <td style="text-align:center">${r.ejecutado||0}</td>
            <td style="text-align:center;font-weight:600;color:${color}">${pct!=null?pct+'%':'—'}</td>
          </tr>`
        }).join('')}</tbody>
      </table>`
    } else {
      panelMensual.style.display = 'none'
    }
  } catch (err) {
    contenedor.innerHTML = `<p class="empty-state" style="color:var(--danger-color)">Error: ${err.message}</p>`
  }
}

document.getElementById('plan-anio')?.addEventListener('change', loadCumplimiento)
document.getElementById('plan-estacion')?.addEventListener('change', loadCumplimiento)

// ─── Modal ítem del plan ──────────────────────────────────────────────────────
const MESES_NOMBRES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function onCambioPeriodicidadPlan(val) {
  const necesita = ['trimestral', 'semestral', 'anual'].includes(val)
  document.getElementById('grupo-mes-inicio').style.display = necesita ? 'block' : 'none'
  const hint = document.getElementById('mes-inicio-hint')
  if (!hint) return
  if (val === 'trimestral') hint.textContent = 'Los otros meses serán +3 y +6 meses después'
  else if (val === 'semestral') hint.textContent = 'El segundo mes será 6 meses después'
  else if (val === 'anual') hint.textContent = 'Solo se planifica ese mes cada año'
  else hint.textContent = ''
}

function abrirModalItemPlan() {
  document.getElementById('ip-periodicidad').value = 'mensual'
  document.getElementById('grupo-pex-plan').style.display = 'none'
  document.getElementById('grupo-mes-inicio').style.display = 'none'
  document.getElementById('ip-equipo').value         = ''
  document.getElementById('ip-codigo').value         = ''
  document.getElementById('ip-unidades').value       = ''
  document.getElementById('ip-tareas').value         = ''
  document.getElementById('ip-vigencia-desde').value = ''
  document.getElementById('tareas-preview').style.display = 'none'
  const est  = document.getElementById('plan-estacion')?.value
  const anio = document.getElementById('plan-anio')?.value
  if (est)  document.getElementById('ip-estacion').value = est
  if (anio) document.getElementById('ip-anio').value     = anio
  document.getElementById('modal-item-plan').style.display = 'flex'
}

function cerrarModalItemPlan() {
  document.getElementById('modal-item-plan').style.display = 'none'
}

function toggleProveedorItemPlan(val) {
  const g = document.getElementById('grupo-pex-plan')
  const i = document.getElementById('ip-proveedor')
  if (g) g.style.display = val === 'PEX' ? 'block' : 'none'
  if (i) i.required = val === 'PEX'
}

document.getElementById('ip-tareas')?.addEventListener('input', function () {
  const tareas = this.value.split('\n').map(t => t.trim()).filter(Boolean)
  const prev   = document.getElementById('tareas-preview')
  if (!tareas.length) { prev.style.display = 'none'; return }
  prev.style.display = 'block'
  prev.innerHTML = `<strong style="color:var(--primary-color)">${tareas.length} ítem${tareas.length > 1 ? 's' : ''}:</strong> ${tareas.map(t => `<span class="tarea-chip" style="font-size:12px">${t}</span>`).join('')}`
})

async function guardarItemPlan() {
  const equipo   = document.getElementById('ip-equipo').value.trim()
  const tareasRaw = document.getElementById('ip-tareas').value
  const tareas   = tareasRaw.split('\n').map(t => t.trim()).filter(Boolean)
  const unidades = document.getElementById('ip-unidades').value.split(/[\n,]+/).map(u => u.trim()).filter(Boolean)
  const resp     = document.getElementById('ip-responsable').value

  if (!equipo)         { showNotification('Ingresá el nombre del equipo.', 'error'); return }
  if (!tareas.length)  { showNotification('Ingresá al menos un ítem a verificar.', 'error'); return }
  if (resp === 'PEX' && !document.getElementById('ip-proveedor').value.trim()) {
    showNotification('Ingresá el nombre del proveedor externo.', 'error'); return
  }

  const periodicidad = document.getElementById('ip-periodicidad').value
  const body = {
    estacion:         document.getElementById('ip-estacion').value,
    anio:             parseInt(document.getElementById('ip-anio').value, 10),
    equipo,
    codigoPrefix:     document.getElementById('ip-codigo').value.trim().toUpperCase() || undefined,
    tareas,
    unidades,
    responsable:      resp,
    proveedorExterno: resp === 'PEX' ? document.getElementById('ip-proveedor').value.trim() : null,
    periodicidad,
    mesInicio:        ['trimestral','semestral','anual'].includes(periodicidad)
                        ? parseInt(document.getElementById('ip-mes-inicio').value, 10)
                        : 0,
    vigenciaDesde:    document.getElementById('ip-vigencia-desde').value || undefined
  }

  const btn = document.querySelector('#modal-item-plan .btn-primary')
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...' }
  try {
    await apiFetch('/plan', { method: 'POST', body: JSON.stringify(body) })
    showNotification('Equipo agregado al plan.')
    cerrarModalItemPlan()
    loadCumplimiento()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Guardar' } }
}

async function eliminarItemPlan(id) {
  if (!confirm('¿Eliminar esta tarea del plan?')) return
  try {
    await apiFetch(`/plan/${id}`, { method: 'DELETE' })
    showNotification('Tarea eliminada.')
    loadCumplimiento()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
}

// ─── Selector de equipo en formulario IA ─────────────────────────────────────
async function cargarSelectIAPlan() {
  const sel = document.getElementById('ia-item-plan')
  if (!sel) return
  const estacion = document.getElementById('estacion-manual')?.value || ''
  const anio     = new Date().getFullYear()
  const params   = new URLSearchParams({ anio })
  if (estacion) params.append('estacion', estacion)
  sel.innerHTML = '<option value="">Detectar automáticamente</option>'
  try {
    const items = await apiFetch('/plan?' + params)
    for (const item of (items || [])) {
      const opt = document.createElement('option')
      opt.value = item._id
      opt.textContent = `${item.equipo}${item.codigoPrefix ? ' (' + item.codigoPrefix + ')' : ''} — ${PERIOD_LABEL[item.periodicidad] || item.periodicidad}`
      sel.appendChild(opt)
    }
  } catch { /* silencioso */ }
}

// ─── Modal: Verificación Manual ───────────────────────────────────────────────
let planItemsCacheManual = []

async function abrirModalManual() {
  // Resetear estado del modal
  document.getElementById('manual-estacion').value       = ''
  document.getElementById('manual-fecha').value          = new Date().toISOString().split('T')[0]
  document.getElementById('manual-item-plan').innerHTML  = '<option value="">Primero seleccioná una estación...</option>'
  document.getElementById('manual-item-plan').disabled   = true
  document.getElementById('manual-unidades-group').style.display = 'none'
  document.getElementById('manual-tareas-group').style.display   = 'none'
  document.getElementById('manual-obs').value            = ''
  document.getElementById('manual-desvios-lista').innerHTML = ''
  desvioManualCount  = 0
  planItemsCacheManual = []

  // Preseleccionar estación si hay una activa en el filtro del plan
  const estacionActiva = document.getElementById('plan-estacion')?.value
  if (estacionActiva) {
    document.getElementById('manual-estacion').value = estacionActiva
    await cargarEquiposManual()
  }

  document.getElementById('modal-manual-insp').style.display = 'flex'
}

async function cargarEquiposManual() {
  const estacion = document.getElementById('manual-estacion').value
  const anio     = document.getElementById('plan-anio')?.value || new Date().getFullYear()
  const sel      = document.getElementById('manual-item-plan')

  if (!estacion) {
    sel.innerHTML = '<option value="">Primero seleccioná una estación...</option>'
    sel.disabled  = true
    planItemsCacheManual = []
    document.getElementById('manual-unidades-group').style.display = 'none'
    document.getElementById('manual-tareas-group').style.display   = 'none'
    return
  }

  sel.innerHTML = '<option value="">Cargando...</option>'
  sel.disabled  = true

  try {
    const params = new URLSearchParams({ anio, estacion })
    planItemsCacheManual = await apiFetch('/plan?' + params)
  } catch {
    planItemsCacheManual = []
  }

  const itemsConTareas = planItemsCacheManual.filter(i => i.tareas?.length > 0)
  sel.innerHTML = itemsConTareas.length
    ? '<option value="">Seleccioná un equipo...</option>'
    : '<option value="">Sin equipos configurados para esta estación</option>'

  for (const item of itemsConTareas) {
    const opt = document.createElement('option')
    opt.value = item._id
    opt.textContent = `${item.equipo}${item.codigoPrefix ? ' (' + item.codigoPrefix + ')' : ''} — ${PERIOD_LABEL[item.periodicidad] || item.periodicidad}`
    sel.appendChild(opt)
  }

  sel.disabled = itemsConTareas.length === 0
  // Resetear selección de unidades/tareas al cambiar estación
  document.getElementById('manual-unidades-group').style.display = 'none'
  document.getElementById('manual-tareas-group').style.display   = 'none'
}

function cerrarModalManual() {
  document.getElementById('modal-manual-insp').style.display = 'none'
  const evInput = document.getElementById('manual-evidencia')
  if (evInput) evInput.value = ''
}

let desvioManualCount = 0

function agregarDesvioManual() {
  const item = planItemsCacheManual.find(i => i._id === document.getElementById('manual-item-plan').value)
  const unidades = item?.unidades || []
  const idx = desvioManualCount++
  const lista = document.getElementById('manual-desvios-lista')
  const div = document.createElement('div')
  div.id = `desvio-manual-${idx}`
  div.style.cssText = 'background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px'
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;font-weight:700;color:#C2410C">⚠ Desvío ${idx + 1}</span>
      <button type="button" onclick="this.closest('[id]').remove()" style="background:none;border:none;cursor:pointer;color:#9CA3AF;font-size:16px">✕</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px">
        <label style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Unidad / Equipo</label>
        <select class="dv-codigo" style="width:100%;margin-top:4px;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid #FED7AA;background:#fff">
          ${unidades.length
            ? unidades.map(u => `<option value="${u}">${u}</option>`).join('')
            : `<option value="${item?.codigoPrefix || ''}">General</option>`}
        </select>
      </div>
      <div style="flex:2;min-width:200px">
        <label style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Descripción del desvío *</label>
        <input type="text" class="dv-desc" required placeholder="Qué falla se detectó..." style="width:100%;margin-top:4px;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid #FED7AA;background:#fff;box-sizing:border-box">
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div style="flex:2;min-width:200px">
        <label style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Acción a implementar *</label>
        <input type="text" class="dv-accion" required placeholder="Acción correctiva..." style="width:100%;margin-top:4px;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid #FED7AA;background:#fff;box-sizing:border-box">
      </div>
      <div style="flex:1;min-width:130px">
        <label style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase">Fecha estimada *</label>
        <input type="date" class="dv-fecha" required style="width:100%;margin-top:4px;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid #FED7AA;background:#fff;box-sizing:border-box">
      </div>
    </div>`
  lista.appendChild(div)
}

function onSelectManualItem(itemId) {
  const item = planItemsCacheManual.find(i => i._id === itemId)
  const unidadesGrp  = document.getElementById('manual-unidades-group')
  const tareasGrp    = document.getElementById('manual-tareas-group')
  const unidadesDiv  = document.getElementById('manual-unidades-checks')
  const tareasDiv    = document.getElementById('manual-tareas-checks')

  if (!item) { unidadesGrp.style.display = 'none'; tareasGrp.style.display = 'none'; return }

  const checkStyle = 'display:flex;align-items:center;gap:6px;cursor:pointer;background:#F8FAFF;border:1px solid #E0E5F2;padding:5px 12px;border-radius:8px;font-size:13px'

  if (item.unidades?.length) {
    unidadesGrp.style.display = 'block'
    unidadesDiv.innerHTML = item.unidades.map(u =>
      `<label style="${checkStyle}"><input type="checkbox" class="manual-unidad-check" value="${u}" checked> ${u}</label>`
    ).join('')
  } else {
    unidadesGrp.style.display = 'none'
  }

  if (item.tareas?.length) {
    tareasGrp.style.display = 'block'
    tareasDiv.innerHTML = item.tareas.map(t =>
      `<label style="${checkStyle}"><input type="checkbox" class="manual-tarea-check" value="${t}" checked> ${t}</label>`
    ).join('')
  } else {
    tareasGrp.style.display = 'none'
  }
}

async function guardarManual() {
  const itemId = document.getElementById('manual-item-plan').value
  const fecha  = document.getElementById('manual-fecha').value
  if (!itemId) { showNotification('Seleccioná un equipo del plan.', 'error'); return }
  if (!fecha)  { showNotification('Ingresá la fecha.', 'error'); return }

  const item = planItemsCacheManual.find(i => i._id === itemId)
  const unidades = item?.unidades?.length
    ? Array.from(document.querySelectorAll('.manual-unidad-check:checked')).map(c => c.value)
    : []
  const tareasVerificadas = Array.from(document.querySelectorAll('.manual-tarea-check:checked')).map(c => c.value)
  const observaciones = document.getElementById('manual-obs').value.trim()

  // Recolectar desvíos
  const desviosNuevos = []
  for (const div of document.querySelectorAll('#manual-desvios-lista > div')) {
    const codigo = div.querySelector('.dv-codigo')?.value?.trim()
    const desc   = div.querySelector('.dv-desc')?.value?.trim()
    const accion = div.querySelector('.dv-accion')?.value?.trim()
    const fecha2 = div.querySelector('.dv-fecha')?.value
    if (!desc || !accion || !fecha2) { showNotification('Completá todos los campos de cada desvío.', 'error'); return }
    desviosNuevos.push({ codigoEquipo: codigo || item?.codigoPrefix || '', descripcionEquipo: item?.equipo || '', observacionFalla: desc, descripcionDesvio: desc, accionImplementar: accion, fechaEstimadaEjecucion: fecha2 })
  }

  const btn = document.querySelector('#modal-manual-insp .btn-primary')
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...' }
  try {
    const fd = new FormData()
    fd.append('datos', JSON.stringify({ itemPlanId: itemId, fecha, unidades, tareasVerificadas, observaciones, desviosNuevos }))
    const evFile = document.getElementById('manual-evidencia')?.files?.[0]
    if (evFile) fd.append('evidencia', evFile)
    await apiFormFetch('/inspecciones/manual', fd)
    const msgs = ['Verificación manual registrada.']
    if (desviosNuevos.length) msgs.push(`${desviosNuevos.length} desvío(s) enviado(s) a gestión.`)
    if (evFile) msgs.push('Evidencia adjuntada.')
    showNotification(msgs.join(' '), 'success')
    desvioManualCount = 0
    cerrarModalManual()
    loadCumplimiento()
    loadKpis()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Guardar Verificación' } }
}

// ─── Modal: Editar equipo del plan ────────────────────────────────────────────
function _crearChip(texto, onRemove) {
  const chip = document.createElement('span')
  chip.className = 'tarea-chip'
  chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;background:#EEF2FF;color:#3730A3;font-size:12px;font-weight:500'
  chip.dataset.valor = texto
  chip.innerHTML = `${escHtml(texto)} <button type="button" style="background:none;border:none;cursor:pointer;font-size:14px;line-height:1;color:#6B7280;padding:0" onclick="this.parentElement.remove()">×</button>`
  return chip
}

function _getChipValues(containerId) {
  return Array.from(document.getElementById(containerId).querySelectorAll('[data-valor]'))
    .map(c => c.dataset.valor)
}

function abrirModalEditarPeriod(id) {
  const item = (window._planItemsCache || {})[id]
  if (!item) return showNotification('Datos del ítem no disponibles. Recargá la página.', 'error')

  document.getElementById('ep-item-id').value = id
  document.getElementById('ep-tarea-label').textContent = item.equipo

  // Poblar tareas chips
  const tareasContainer = document.getElementById('ep-tareas-chips')
  tareasContainer.innerHTML = ''
  for (const t of (item.tareas || [])) tareasContainer.appendChild(_crearChip(t))

  // Poblar unidades chips
  const unidadesContainer = document.getElementById('ep-unidades-chips')
  unidadesContainer.innerHTML = ''
  for (const u of (item.unidades || [])) unidadesContainer.appendChild(_crearChip(u))

  // Periodicidad y "Aplicar desde"
  const periodActual = item.periodicidad
  document.getElementById('ep-periodicidad').value = periodActual

  const ahora = new Date()
  const anio  = parseInt(document.getElementById('plan-anio')?.value || ahora.getFullYear(), 10)
  const sel   = document.getElementById('ep-desde')
  sel.innerHTML = ''
  for (let m = 0; m < 12; m++) {
    const val      = `${anio}-${String(m + 1).padStart(2, '0')}-01`
    const esPasado = m < ahora.getMonth() && anio <= ahora.getFullYear()
    sel.innerHTML += `<option value="${val}"${m === ahora.getMonth() ? ' selected' : ''}>${MESES_NOMBRES[m]} ${anio}${esPasado ? ' (pasado)' : ''}</option>`
  }

  document.getElementById('ep-info').style.display = 'none'
  document.getElementById('ep-periodicidad').onchange = function () {
    if (this.value !== periodActual) {
      actualizarInfoEditarPeriod(periodActual, this.value)
      document.getElementById('ep-info').style.display = 'block'
    } else {
      document.getElementById('ep-info').style.display = 'none'
    }
  }
  document.getElementById('ep-desde').onchange = function () {
    const pNuevo = document.getElementById('ep-periodicidad').value
    if (pNuevo !== periodActual) actualizarInfoEditarPeriod(periodActual, pNuevo)
  }
  document.getElementById('modal-editar-period').style.display = 'flex'
}

function agregarTareaEdicion() {
  const input = document.getElementById('ep-nueva-tarea')
  const val   = input.value.trim()
  if (!val) return
  const existentes = _getChipValues('ep-tareas-chips')
  if (existentes.includes(val)) return showNotification('Esa tarea ya existe', 'error')
  document.getElementById('ep-tareas-chips').appendChild(_crearChip(val))
  input.value = ''
  input.focus()
}

function agregarUnidadEdicion() {
  const input = document.getElementById('ep-nueva-unidad')
  const val   = input.value.trim()
  if (!val) return
  const existentes = _getChipValues('ep-unidades-chips')
  if (existentes.includes(val)) return showNotification('Esa unidad ya existe', 'error')
  document.getElementById('ep-unidades-chips').appendChild(_crearChip(val))
  input.value = ''
  input.focus()
}

function actualizarInfoEditarPeriod(periodViejo, periodNuevo) {
  const desde  = document.getElementById('ep-desde')?.value
  const mesIdx = desde ? new Date(desde + 'T12:00:00').getMonth() : new Date().getMonth()
  const PERIOD_LBL = { diario:'Diario', semanal:'Semanal', quincenal:'Quincenal', mensual:'Mensual', trimestral:'Trimestral', semestral:'Semestral', anual:'Anual' }
  const info = document.getElementById('ep-info')
  if (!info) return
  info.innerHTML = `Meses anteriores a <strong>${MESES_NOMBRES[mesIdx]}</strong>: conservan <strong>${PERIOD_LBL[periodViejo]||periodViejo}</strong>.<br>
    Desde <strong>${MESES_NOMBRES[mesIdx]}</strong>: nueva periodicidad <strong>${PERIOD_LBL[periodNuevo]||periodNuevo}</strong>.<br>
    <span style="font-size:12px;opacity:0.8">El historial de cumplimiento de meses anteriores no cambia.</span>`
}

function cerrarModalEditarPeriod() {
  document.getElementById('modal-editar-period').style.display = 'none'
}

async function guardarCambioPeriod() {
  const id           = document.getElementById('ep-item-id').value
  const periodicidad = document.getElementById('ep-periodicidad').value
  const aplicarDesde = document.getElementById('ep-desde').value
  const tareas       = _getChipValues('ep-tareas-chips')
  const unidades     = _getChipValues('ep-unidades-chips')

  const item = (window._planItemsCache || {})[id]
  const periodActual = item?.periodicidad

  const cambioPeriod = periodicidad !== periodActual

  try {
    await apiFetch(`/plan/${id}`, {
      method: 'PUT',
      body: JSON.stringify(cambioPeriod
        ? { periodicidad, aplicarDesde, tareas, unidades }
        : { tareas, unidades }
      )
    })
    showNotification('Cambios guardados.', 'success')
    cerrarModalEditarPeriod()
    loadCumplimiento()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
}

// ─── Repositorio de verificaciones ───────────────────────────────────────────
async function loadRepositorio() {
  const lista    = document.getElementById('repo-lista')
  const estacion = document.getElementById('repo-estacion')?.value || ''
  if (!lista) return
  lista.innerHTML = '<p class="empty-state">Cargando...</p>'
  try {
    const inspecciones = await apiFetch('/inspecciones')
    const filtradas = estacion ? inspecciones.filter(i => i.estacion === estacion) : inspecciones
    if (!filtradas.length) {
      lista.innerHTML = '<div class="empty-state-card"><span style="font-size:2rem">📂</span><p>No hay verificaciones registradas.</p></div>'
      return
    }
    lista.innerHTML = `<table class="tabla-plan" style="width:100%">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Estación</th>
          <th>Tipo</th>
          <th>Ítems verificados</th>
          <th style="text-align:center">Fallas</th>
          <th style="text-align:center">Evidencia</th>
        </tr>
      </thead>
      <tbody>
        ${filtradas.map(i => {
          const fecha = new Date(i.fecha || i.createdAt).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
          const tipo  = i.archivoNombre === 'Verificación manual' ? '✏ Manual' : '🤖 IA'
          const fallas = i.tieneFallas
            ? `<span style="color:var(--danger-color);font-weight:600">Sí (${(i.desviosGenerados||[]).length})</span>`
            : `<span style="color:var(--success-color)">No</span>`
          const tareas = (i.tareasVerificadas || []).slice(0, 3).join(', ') + (i.tareasVerificadas?.length > 3 ? '…' : '')
          const evidenciaBtn = i.evidenciaNombre
            ? `<button class="btn-secondary btn-sm" onclick="verEvidencia('${i._id}')" title="${escHtml(i.evidenciaNombre)}">📎 Ver</button>`
            : `<span style="color:var(--text-secondary);font-size:12px">—</span>`
          const editBtn = usuarioActual?.rol === 'admin'
            ? `<button class="btn-icon-sm" style="color:var(--primary-color)" onclick="abrirModalEditarInsp('${i._id}')" title="Editar verificación">✏</button>`
            : ''
          const elimBtn = usuarioActual?.rol === 'admin'
            ? `<button class="btn-icon-sm" style="color:var(--danger-color)" onclick="eliminarInspeccion('${i._id}')" title="Eliminar verificación">✕</button>`
            : ''
          return `<tr>
            <td style="white-space:nowrap">${fecha}</td>
            <td>${i.estacion}</td>
            <td style="white-space:nowrap">${tipo}</td>
            <td style="font-size:12px;color:var(--text-secondary)">${tareas || '—'}</td>
            <td style="text-align:center">${fallas}</td>
            <td style="text-align:center;display:flex;gap:6px;justify-content:center;align-items:center">${evidenciaBtn}${editBtn}${elimBtn}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`
  } catch (err) {
    lista.innerHTML = `<p class="empty-state" style="color:var(--danger-color)">Error: ${err.message}</p>`
  }
}

async function verEvidencia(id) {
  try {
    const token = localStorage.getItem('sgi_token')
    const res   = await fetch(`/api/inspecciones/${id}/evidencia`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { showNotification('Esta verificación no tiene evidencia adjunta.', 'error'); return }
    const blob  = await res.blob()
    const url   = URL.createObjectURL(blob)
    window.open(url, '_blank')
  } catch { showNotification('Error al cargar evidencia.', 'error') }
}

// ─── Modal: Editar inspección (admin) ────────────────────────────────────────
let _inspEditCache = null
let _desvioEditCount = 0

async function abrirModalEditarInsp(id) {
  try {
    // Buscar la inspección en la lista ya cargada (o hacer fetch)
    const inspecciones = await apiFetch('/inspecciones')
    const insp = inspecciones.find(i => i._id === id)
    if (!insp) { showNotification('Inspección no encontrada.', 'error'); return }
    _inspEditCache = insp
    _desvioEditCount = 0

    document.getElementById('ei-insp-id').value = id
    document.getElementById('ei-estacion').value = insp.estacion || ''
    document.getElementById('ei-fecha').value = insp.fecha
      ? new Date(insp.fecha).toISOString().split('T')[0]
      : new Date(insp.createdAt).toISOString().split('T')[0]
    document.getElementById('ei-observaciones').value = insp.observacionesGenerales || ''
    document.getElementById('ei-desvios-nuevos').innerHTML = ''

    const tipo = insp.archivoNombre === 'Verificación manual' ? '✏ Manual' : '🤖 IA'
    document.getElementById('ei-titulo-sub').textContent =
      `${tipo} · ${insp.estacion} · ${new Date(insp.fecha || insp.createdAt).toLocaleDateString('es-AR')}`

    // Mostrar desvíos ya existentes
    const cont = document.getElementById('ei-desvios-existentes')
    const devs = insp.desviosGenerados || []
    if (!devs.length) {
      cont.innerHTML = '<p style="font-size:12px;color:var(--text-secondary)">Sin desvíos registrados.</p>'
    } else {
      cont.innerHTML = devs.map(d =>
        `<div style="padding:8px 12px;background:#FEF3C7;border-radius:8px;font-size:12px">
          <strong>${escHtml(d.codigoEquipo || '')}</strong>
          <span style="color:var(--text-secondary);margin-left:6px">Estado: ${d.estado}</span>
        </div>`
      ).join('')
    }

    document.getElementById('modal-editar-insp').style.display = 'flex'
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
}

function cerrarModalEditarInsp() {
  document.getElementById('modal-editar-insp').style.display = 'none'
  _inspEditCache = null
}

function agregarDesvioEdicionInsp() {
  const idx  = _desvioEditCount++
  const cont = document.getElementById('ei-desvios-nuevos')
  const div  = document.createElement('div')
  div.style.cssText = 'background:#F8FAFC;border:1px solid #E0E5F2;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px'
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;font-weight:600;color:var(--text-secondary)">Nuevo desvío</span>
      <button type="button" class="btn-icon-sm" style="color:var(--danger-color)" onclick="this.closest('div[data-idx]').remove()">✕</button>
    </div>
    <div class="form-row" style="gap:8px">
      <input class="ei-dv-codigo" placeholder="Código equipo (ej: CC 03)" style="flex:1;font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid #E0E5F2">
      <input class="ei-dv-desc" placeholder="Descripción del equipo" style="flex:2;font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid #E0E5F2">
    </div>
    <textarea class="ei-dv-obs" rows="2" placeholder="Descripción del desvío / falla observada" style="font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid #E0E5F2;resize:vertical"></textarea>
    <input class="ei-dv-accion" placeholder="Acción a implementar" style="font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid #E0E5F2">
    <div class="form-row" style="gap:8px">
      <div class="form-group" style="flex:1;margin:0">
        <label style="font-size:12px">Fecha estimada</label>
        <input type="date" class="ei-dv-fecha" style="font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid #E0E5F2;width:100%">
      </div>
    </div>`
  div.setAttribute('data-idx', idx)
  cont.appendChild(div)
}

async function guardarEdicionInsp() {
  const id            = document.getElementById('ei-insp-id').value
  const fecha         = document.getElementById('ei-fecha').value
  const observaciones = document.getElementById('ei-observaciones').value.trim()

  const desviosNuevos = []
  for (const div of document.querySelectorAll('#ei-desvios-nuevos [data-idx]')) {
    const codigo = div.querySelector('.ei-dv-codigo')?.value?.trim()
    const desc   = div.querySelector('.ei-dv-desc')?.value?.trim()
    const obs    = div.querySelector('.ei-dv-obs')?.value?.trim()
    const accion = div.querySelector('.ei-dv-accion')?.value?.trim()
    const fechaD = div.querySelector('.ei-dv-fecha')?.value
    if (!obs || !accion || !fechaD) { showNotification('Completá todos los campos del desvío.', 'error'); return }
    desviosNuevos.push({
      codigoEquipo: codigo || _inspEditCache?.estacion || '',
      descripcionEquipo: desc || '',
      observacionFalla: obs,
      descripcionDesvio: obs,
      accionImplementar: accion,
      fechaEstimadaEjecucion: fechaD
    })
  }

  const btn = document.getElementById('ei-btn-guardar')
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...' }
  try {
    await apiFetch(`/inspecciones/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ fecha, observacionesGenerales: observaciones, desviosNuevos })
    })
    const msgs = ['Verificación actualizada.']
    if (desviosNuevos.length) msgs.push(`${desviosNuevos.length} desvío(s) agregado(s).`)
    showNotification(msgs.join(' '), 'success')
    cerrarModalEditarInsp()
    loadRepositorio()
    loadKpis()
    loadCumplimiento()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios' } }
}

async function eliminarInspeccion(id) {
  if (!confirm('¿Eliminar esta verificación? Se quitará del ejecutado y no se puede deshacer.')) return
  try {
    await apiFetch(`/inspecciones/${id}`, { method: 'DELETE' })
    showNotification('Verificación eliminada.', 'success')
    loadRepositorio()
    loadCumplimiento()
    loadKpis()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
}

// ─── Utilidades ───────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—'
  try { return new Date(dateStr).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
  catch { return dateStr }
}
function escHtml(str) { return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;') }

// ─── Init ─────────────────────────────────────────────────────────────────────
;(function init() {
  const token   = localStorage.getItem('sgi_token')
  const usuario = localStorage.getItem('sgi_usuario')
  if (token && usuario) {
    try { usuarioActual = JSON.parse(usuario); iniciarDashboard() }
    catch { mostrarLogin() }
  } else {
    mostrarLogin()
  }
})()
