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
  loadKpis()
  inicializarCharts()
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
    onEnter: () => loadKpis()
  },
  'view-mantenimiento': {
    title: 'Plan de Mantenimiento Preventivo',
    subtitle: 'Análisis automático con IA · Gestión de desvíos (Anexo 3.3)',
    onEnter: () => { loadKpis(); loadCumplimiento() }
  },
  'view-desvios': {
    title: 'Desvíos Pendientes',
    subtitle: 'Bandeja de gestión y cierre de desvíos abiertos',
    onEnter: () => loadDesviosPendientes()
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
async function loadKpis() {
  try {
    const d = await apiFetch('/inspecciones/kpis')
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
      colorearTrend('kpi-disponibilidad', d.disponibilidad, 90)
    }

    if (d.eficaciaDesvios !== null && d.desviosDetectadosMes > 0) {
      setText('kpi-eficacia',     d.eficaciaDesvios)
      setText('kpi-eficacia-sub', `${d.cerradosMes} cerrados de ${d.desviosDetectadosMes} detectados`)
      colorearTrend('kpi-eficacia', d.eficaciaDesvios, 80)
    }

    const sub = document.getElementById('kpi-resumen-total-sub')
    if (sub) sub.textContent = d.conFallasMes > 0 ? `${d.conFallasMes} con fallas detectadas` : 'Sin fallas este mes ✓'

    updateGauge(d.disponibilidad)

    const badge = document.getElementById('badge-pendientes')
    if (badge) { badge.textContent = d.pendientes; badge.style.display = d.pendientes > 0 ? 'inline-flex' : 'none' }
  } catch (_) {}
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
  const gradient = barCtx.createLinearGradient(0, 0, 0, 400)
  gradient.addColorStop(0, '#4318FF')
  gradient.addColorStop(1, 'rgba(67,24,255,0.2)')
  new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: ['Octubre', 'Noviembre', 'Diciembre', 'Enero', 'Febrero', 'Marzo'],
      datasets: [
        { label: 'Hudson',   data: [45,52,38,41,30,25], backgroundColor: gradient, borderRadius: 8, barPercentage: 0.6, categoryPercentage: 0.8 },
        { label: 'Dock Sud', data: [35,40,42,35,28,20], backgroundColor: '#00E396', borderRadius: 8, barPercentage: 0.6, categoryPercentage: 0.8 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', align: 'end' }, tooltip: { backgroundColor: '#1B2559', cornerRadius: 8 } },
      scales: { y: { beginAtZero: true, border: { display: false } }, x: { border: { display: false }, grid: { display: false } } }
    }
  })
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
  MVI:'Personal', MED:'Personal', ELE:'Electricista', JES:'Jefe Estación', PEX:'Prov. Externo'
}
const PERIOD_LABEL = {
  diario:'Diario', semanal:'Semanal', quincenal:'Quincenal', mensual:'Mensual',
  trimestral:'Trimestral', semestral:'Semestral', anual:'Anual'
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

    const { resultado, porEquipo, mesActual } = await apiFetch('/plan/cumplimiento?' + params)

    if (mesActual?.porcentaje != null) updateGauge(mesActual.porcentaje)

    if (!porEquipo?.length) {
      contenedor.innerHTML = `<div class="empty-state-card">
        <span style="font-size:2rem">📋</span>
        <p>No hay tareas en el plan para ${anio}${estacion ? ' · ' + estacion : ''}.</p>
        ${usuarioActual?.rol === 'admin' ? '<p style="color:var(--primary-color);font-size:13px;margin-top:4px">Usá "+ Agregar Tarea" para cargar el plan.</p>' : ''}
      </div>`
      document.getElementById('panel-cumplimiento-mensual').style.display = 'none'
      return
    }

    // Tabla estilo Excel
    const periodos = ['diario','semanal','quincenal','mensual','trimestral','semestral','anual']
    let html = `<div style="overflow-x:auto"><table class="tabla-excel-plan">
      <thead><tr>
        <th class="col-equipo">Equipo / Máquina</th>
        <th class="col-tarea">Tarea / Ítem a verificar</th>
        <th class="col-resp">Resp.</th>
        ${periodos.map(p => `<th class="col-period">${PERIOD_LABEL[p]}</th>`).join('')}
        ${usuarioActual?.rol === 'admin' ? '<th class="col-acc"></th>' : ''}
      </tr></thead><tbody>`

    for (const grupo of porEquipo) {
      grupo.tareas.forEach((t, idx) => {
        const respLabel = t.responsable === 'PEX' && t.proveedorExterno
          ? t.proveedorExterno.slice(0, 12)
          : (RESP_LABEL[t.responsable] || t.responsable)
        html += `<tr>
          ${idx === 0 ? `<td class="col-equipo equipo-cell" rowspan="${grupo.tareas.length}"><strong>${grupo.equipo}</strong></td>` : ''}
          <td class="col-tarea">${t.tarea}</td>
          <td class="col-resp"><span class="resp-badge resp-${(t.responsable||'').toLowerCase()}" title="${respLabel}">${t.responsable}</span></td>
          ${periodos.map(p => `<td class="col-period">${t.periodicidad === p ? '<span class="period-check">✓</span>' : ''}</td>`).join('')}
          ${usuarioActual?.rol === 'admin' ? `<td class="col-acc" style="white-space:nowrap">
            <button class="btn-icon-sm" style="color:var(--primary-color)" onclick="abrirModalEditarPeriod('${t._id}','${(t.tarea||'').replace(/'/g,"\\'")}','${t.periodicidad}')" title="Cambiar periodicidad">✏</button>
            <button class="btn-icon-sm" onclick="eliminarItemPlan('${t._id}')" title="Eliminar">✕</button>
          </td>` : ''}
        </tr>`
      })
    }
    html += '</tbody></table></div>'
    contenedor.innerHTML = html

    // Cumplimiento mensual
    const panelMensual = document.getElementById('panel-cumplimiento-mensual')
    const tablaCump    = document.getElementById('tabla-cumplimiento')
    if (resultado?.some(r => r.planificado > 0)) {
      panelMensual.style.display = 'block'
      const mesActualNombre = MESES_ES[new Date().getMonth()]
      tablaCump.innerHTML = `<table class="tabla-plan">
        <thead><tr><th>Mes</th><th style="text-align:center">Planificado</th><th style="text-align:center">Ejecutado</th><th style="text-align:center">%</th></tr></thead>
        <tbody>${resultado.map((r, i) => {
          const esMes = r.mes === mesActualNombre
          const pct   = r.planificado > 0 ? r.porcentaje : null
          const color = pct == null ? '' : pct >= 90 ? 'var(--success-color)' : pct >= 70 ? '#F79009' : 'var(--danger-color)'
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

function abrirModalItemPlan() {
  switchPlanTab('individual')
  document.getElementById('ip-periodicidad').value = 'mensual'
  document.getElementById('grupo-pex-plan').style.display = 'none'
  document.getElementById('ip-tarea').value = ''
  document.getElementById('ip-tareas-bulk').value = ''
  document.getElementById('bulk-preview').style.display = 'none'
  const est  = document.getElementById('plan-estacion')?.value
  const anio = document.getElementById('plan-anio')?.value
  if (est)  document.getElementById('ip-estacion').value = est
  if (anio) document.getElementById('ip-anio').value     = anio
  document.getElementById('modal-item-plan').style.display = 'flex'
}

function cerrarModalItemPlan() {
  document.getElementById('modal-item-plan').style.display = 'none'
}

function switchPlanTab(tab) {
  document.getElementById('panel-individual').style.display = tab === 'individual' ? 'block' : 'none'
  document.getElementById('panel-multiple').style.display   = tab === 'multiple'   ? 'block' : 'none'
  document.getElementById('tab-individual').classList.toggle('active', tab === 'individual')
  document.getElementById('tab-multiple').classList.toggle('active', tab === 'multiple')
}

function toggleProveedorItemPlan(val) {
  const g = document.getElementById('grupo-pex-plan')
  const i = document.getElementById('ip-proveedor')
  if (g) g.style.display = val === 'PEX' ? 'block' : 'none'
  if (i) i.required = val === 'PEX'
}

function buildItemPlanBase() {
  const resp = document.getElementById('ip-responsable').value
  return {
    estacion:         document.getElementById('ip-estacion').value,
    anio:             parseInt(document.getElementById('ip-anio').value, 10),
    equipo:           document.getElementById('ip-equipo').value.trim(),
    codigoPrefix:     document.getElementById('ip-codigo').value.trim().toUpperCase() || undefined,
    responsable:      resp,
    proveedorExterno: resp === 'PEX' ? document.getElementById('ip-proveedor').value.trim() : null,
    periodicidad:     document.getElementById('ip-periodicidad').value
  }
}

async function guardarItemPlanIndividual() {
  const tarea = document.getElementById('ip-tarea').value.trim()
  if (!tarea) { showNotification('Ingresá la tarea.', 'error'); return }
  const base = buildItemPlanBase()
  if (!base.equipo) { showNotification('Ingresá el equipo.', 'error'); return }
  if (base.responsable === 'PEX' && !base.proveedorExterno) { showNotification('Ingresá el nombre del proveedor.', 'error'); return }
  try {
    await apiFetch('/plan', { method: 'POST', body: JSON.stringify({ ...base, tarea }) })
    showNotification('Tarea agregada al plan.')
    cerrarModalItemPlan()
    loadCumplimiento()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
}

async function guardarYAgregarOtro() {
  const tarea = document.getElementById('ip-tarea').value.trim()
  const base  = buildItemPlanBase()
  if (!base.equipo || !tarea) { showNotification('Completá Equipo y Tarea.', 'error'); return }
  if (base.responsable === 'PEX' && !base.proveedorExterno) { showNotification('Ingresá el nombre del proveedor.', 'error'); return }
  const btn = document.getElementById('btn-guardar-otro')
  btn.disabled = true; btn.textContent = 'Guardando...'
  try {
    await apiFetch('/plan', { method: 'POST', body: JSON.stringify({ ...base, tarea }) })
    showNotification('Tarea guardada. Podés agregar otra.', 'success')
    document.getElementById('ip-tarea').value = ''
    document.getElementById('ip-tarea').focus()
    loadCumplimiento()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
  finally { btn.disabled = false; btn.textContent = 'Guardar y agregar otro' }
}

document.getElementById('ip-tareas-bulk')?.addEventListener('input', function () {
  const tareas = this.value.split('\n').map(t => t.trim()).filter(Boolean)
  const prev   = document.getElementById('bulk-preview')
  if (!tareas.length) { prev.style.display = 'none'; return }
  prev.style.display = 'block'
  prev.innerHTML = `<strong style="color:var(--primary-color)">${tareas.length} tarea${tareas.length > 1 ? 's' : ''} a crear:</strong> ${tareas.map(t => `<span style="display:inline-block;background:#fff;border-radius:6px;padding:2px 8px;margin:2px;font-size:12px">${t}</span>`).join('')}`
})

async function guardarMultiplesTareas() {
  const raw    = document.getElementById('ip-tareas-bulk').value
  const tareas = raw.split('\n').map(t => t.trim()).filter(Boolean)
  if (!tareas.length) { showNotification('Ingresá al menos una tarea.', 'error'); return }
  const base = buildItemPlanBase()
  if (!base.equipo) { showNotification('Ingresá el equipo.', 'error'); return }
  if (base.responsable === 'PEX' && !base.proveedorExterno) { showNotification('Ingresá el nombre del proveedor.', 'error'); return }
  const btn = document.getElementById('btn-guardar-bulk')
  btn.disabled = true; btn.textContent = 'Guardando...'
  try {
    const items = tareas.map(tarea => ({ ...base, tarea }))
    await apiFetch('/plan/bulk', { method: 'POST', body: JSON.stringify({ items }) })
    showNotification(`${tareas.length} tarea${tareas.length > 1 ? 's' : ''} agregadas al plan.`, 'success')
    cerrarModalItemPlan()
    loadCumplimiento()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
  finally { btn.disabled = false; btn.textContent = 'Guardar todas' }
}

async function eliminarItemPlan(id) {
  if (!confirm('¿Eliminar esta tarea del plan?')) return
  try {
    await apiFetch(`/plan/${id}`, { method: 'DELETE' })
    showNotification('Tarea eliminada.')
    loadCumplimiento()
  } catch (err) { showNotification('Error: ' + err.message, 'error') }
}

// ─── Modal: Cambiar periodicidad (versionado) ─────────────────────────────────
function abrirModalEditarPeriod(id, tareaLabel, periodActual) {
  document.getElementById('ep-item-id').value = id
  document.getElementById('ep-tarea-label').textContent = tareaLabel
  document.getElementById('ep-periodicidad').value = periodActual

  const ahora = new Date()
  const anio  = parseInt(document.getElementById('plan-anio')?.value || ahora.getFullYear(), 10)
  const sel   = document.getElementById('ep-desde')
  sel.innerHTML = ''
  for (let m = ahora.getMonth(); m < 12; m++) {
    const val = `${anio}-${String(m + 1).padStart(2, '0')}-01`
    sel.innerHTML += `<option value="${val}">${MESES_NOMBRES[m]} ${anio}</option>`
  }

  actualizarInfoEditarPeriod(periodActual, periodActual)
  document.getElementById('ep-periodicidad').onchange = function () { actualizarInfoEditarPeriod(periodActual, this.value) }
  document.getElementById('ep-desde').onchange = function () { actualizarInfoEditarPeriod(periodActual, document.getElementById('ep-periodicidad').value) }
  document.getElementById('modal-editar-period').style.display = 'flex'
}

function actualizarInfoEditarPeriod(periodViejo, periodNuevo) {
  const desde = document.getElementById('ep-desde')?.value
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
  try {
    await apiFetch(`/plan/${id}`, { method: 'PUT', body: JSON.stringify({ periodicidad, aplicarDesde }) })
    showNotification('Periodicidad actualizada. El historial anterior no cambió.', 'success')
    cerrarModalEditarPeriod()
    loadCumplimiento()
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
