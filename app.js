// En produccion (Render) usa URL relativa; en desarrollo local usa el puerto del backend
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3002/api'
  : '/api'

// ─── Estado global del flujo de análisis ────────────────────────────────────
let currentFile             = null   // File seleccionado
let analisisActual          = null   // Resultado de la IA
let desviosCierrePosible    = []     // Desvíos abiertos que pueden cerrarse
let desviosSeleccionados    = new Set()  // IDs de desvíos que el usuario quiere cerrar
let desvioIdParaCerrar      = null   // ID del desvío abierto en el modal de cierre manual

// ─── API helpers ─────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(API_URL + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Error ${res.status}`)
  }
  return res.json()
}

async function apiFormFetch(path, formData) {
  const res = await fetch(API_URL + path, { method: 'POST', body: formData })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Error ${res.status}`)
  }
  return res.json()
}

// ─── Toast notifications ─────────────────────────────────────────────────────
function showNotification(msg, type = 'success') {
  const n = document.createElement('div')
  n.className = `notification ${type}`
  n.textContent = msg
  document.body.appendChild(n)
  setTimeout(() => n.classList.add('show'), 10)
  setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 400) }, 4000)
}

// ─── Gauge Chart ─────────────────────────────────────────────────────────────
Chart.defaults.font.family = "'Inter', sans-serif"
Chart.defaults.color = '#A3AED0'
Chart.defaults.scale.grid.color = 'rgba(163, 174, 208, 0.1)'

let gaugeChart
const gaugeCtx = document.getElementById('gaugeChart').getContext('2d')
gaugeChart = new Chart(gaugeCtx, {
  type: 'doughnut',
  data: {
    labels: ['Cumplido', 'Restante'],
    datasets: [{
      data: [0, 100],
      backgroundColor: ['#4318FF', '#F4F7FE'],
      borderWidth: 0,
      borderRadius: [20, 0],
      cutout: '80%'
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    rotation: 270, circumference: 180,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    animation: { animateScale: true, animateRotate: true }
  }
})

function updateGauge(pct) {
  if (pct === null || pct === undefined) return
  gaugeChart.data.datasets[0].data = [pct, 100 - pct]
  gaugeChart.update()
  document.getElementById('gauge-pct').textContent = pct + '%'
  const el = document.getElementById('kpi-resumen-cumplimiento')
  if (el) el.textContent = pct
}

// ─── Bar Chart ───────────────────────────────────────────────────────────────
const barCtx = document.getElementById('barChart').getContext('2d')
const gradient = barCtx.createLinearGradient(0, 0, 0, 400)
gradient.addColorStop(0, '#4318FF')
gradient.addColorStop(1, 'rgba(67, 24, 255, 0.2)')

new Chart(barCtx, {
  type: 'bar',
  data: {
    labels: ['Octubre', 'Noviembre', 'Diciembre', 'Enero', 'Febrero', 'Marzo'],
    datasets: [
      { label: 'Hudson', data: [45, 52, 38, 41, 30, 25], backgroundColor: gradient, borderRadius: 8, barPercentage: 0.6, categoryPercentage: 0.8 },
      { label: 'Dock Sud', data: [35, 40, 42, 35, 28, 20], backgroundColor: '#00E396', borderRadius: 8, barPercentage: 0.6, categoryPercentage: 0.8 }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, font: { weight: '500' } } },
      tooltip: { backgroundColor: '#1B2559', padding: 12, cornerRadius: 8 }
    },
    scales: {
      y: { beginAtZero: true, border: { display: false }, ticks: { padding: 10 } },
      x: { border: { display: false }, grid: { display: false }, ticks: { font: { weight: '500' } } }
    },
    animation: { y: { duration: 2000, easing: 'easeOutQuart' } }
  }
})

// ─── Navigation ──────────────────────────────────────────────────────────────
const navItems     = document.querySelectorAll('.nav-item[data-target]')
const viewSections = document.querySelectorAll('.view-section')
const pageTitle    = document.getElementById('dynamic-title')
const pageSubtitle = document.getElementById('dynamic-subtitle')

const viewMeta = {
  'view-resumen': {
    title:    'Indicadores del Sistema de Gestión Integrado',
    subtitle: 'Monitoreo en tiempo real · Normas ISO 9001 e ISO 39001',
    onEnter:  () => loadKpis()
  },
  'view-mantenimiento': {
    title:    'Plan de Mantenimiento Preventivo',
    subtitle: 'Análisis automático con IA · Gestión de desvíos (Anexo 3.3)',
    onEnter:  () => loadKpis()
  },
  'view-desvios': {
    title:    'Desvíos Pendientes',
    subtitle: 'Bandeja de gestión y cierre de desvíos abiertos',
    onEnter:  () => loadDesviosPendientes()
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
    if (meta) {
      pageTitle.textContent    = meta.title
      pageSubtitle.textContent = meta.subtitle
      meta.onEnter?.()
    }
  })
})

// ─── KPIs ─────────────────────────────────────────────────────────────────────
async function loadKpis() {
  try {
    const d = await apiFetch('/inspecciones/kpis')

    setText('kpi-total',     d.totalMes)
    setText('kpi-pendientes', d.pendientes)
    setText('kpi-cerrados',   d.cerradosMes)
    setText('kpi-resumen-desvios', d.pendientes)
    setText('kpi-desvios-abiertos', d.pendientes)
    setText('kpi-desvios-cerrados-mes', d.cerradosMes)

    const sub = document.getElementById('kpi-total-sub')
    if (sub) sub.textContent = d.conFallasMes > 0
      ? `${d.conFallasMes} con fallas detectadas`
      : 'Sin fallas detectadas'

    updateGauge(d.cumplimiento)

    // Badge en nav
    const badge = document.getElementById('badge-pendientes')
    if (badge) {
      if (d.pendientes > 0) {
        badge.textContent = d.pendientes
        badge.style.display = 'inline-flex'
      } else {
        badge.style.display = 'none'
      }
    }
  } catch (_) {
    // Backend no disponible: no rompe la UI
  }
}

function setText(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = (val !== null && val !== undefined) ? val : '—'
}

// ─── File input visual ────────────────────────────────────────────────────────
const fileInput      = document.getElementById('archivo')
const fileVisualText = document.getElementById('file-visual-text')

if (fileInput) {
  fileInput.addEventListener('change', e => {
    currentFile = e.target.files[0] || null
    if (currentFile) {
      fileVisualText.textContent = currentFile.name
      fileVisualText.style.color = 'var(--success-color)'
    } else {
      resetFileVisual()
    }
  })
}

function resetFileVisual() {
  if (fileVisualText) {
    fileVisualText.textContent = 'Subir PDF o imagen del Anexo 3.6'
    fileVisualText.style.color = 'var(--primary-color)'
  }
}

// ─── PASO 1: Análisis con IA ──────────────────────────────────────────────────
const analizarForm = document.getElementById('analizar-form')
const btnAnalizar  = document.getElementById('btn-analizar')

analizarForm?.addEventListener('submit', async e => {
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
  const icon = document.getElementById('btn-analizar-icon')
  const text = document.getElementById('btn-analizar-text')
  btnAnalizar.disabled = loading
  text.textContent = loading ? 'Analizando...' : 'Analizar con IA'
  icon.innerHTML = loading
    ? '<div class="spinner"></div>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
}

// ─── PASO 2: Mostrar resultados ───────────────────────────────────────────────
function mostrarResultados() {
  const equipos  = analisisActual?.equipos || []
  const fallas   = equipos.filter(e => e.estado === 'falla')
  const correctos = equipos.filter(e => e.estado === 'correcto')

  // Cabecera con datos detectados
  const meta = []
  if (analisisActual.estacion) meta.push(`📍 ${analisisActual.estacion}`)
  if (analisisActual.fecha)    meta.push(`📅 ${formatDate(analisisActual.fecha)}`)
  if (analisisActual.operador) meta.push(`👤 ${analisisActual.operador}`)
  document.getElementById('resultado-meta').innerHTML =
    meta.length ? `<span class="meta-chips">${meta.map(m => `<span class="meta-chip">${m}</span>`).join('')}</span>` : ''

  // Badge general
  const badge = document.getElementById('resultado-badge')
  if (fallas.length === 0) {
    badge.className = 'resultado-badge badge-ok'
    badge.textContent = `✓ ${correctos.length} ítems conformes`
  } else {
    badge.className = 'resultado-badge badge-falla'
    badge.textContent = `⚠ ${fallas.length} falla${fallas.length > 1 ? 's' : ''} detectada${fallas.length > 1 ? 's' : ''}`
  }

  // Grid de equipos
  document.getElementById('equipos-resultado').innerHTML =
    equipos.length
      ? equipos.map(eq => renderEquipoCard(eq)).join('')
      : '<p class="empty-state">No se detectaron equipos en el documento. Revisá que la imagen sea legible.</p>'

  // Panel auto-cierre
  const panelAuto = document.getElementById('panel-autoclose')
  if (desviosCierrePosible.length > 0) {
    panelAuto.style.display = 'block'
    document.getElementById('autoclose-lista').innerHTML =
      desviosCierrePosible.map(d => `
        <label class="autoclose-item">
          <input type="checkbox" class="autoclose-check" data-id="${d._id}" onchange="toggleAutoclose('${d._id}', this.checked)">
          <div>
            <span class="equipo-badge badge-ok-small">${d.codigoEquipo}</span>
            <strong>${d.descripcionEquipo || ''}</strong>
            <span class="autoclose-falla">Falla previa: ${d.observacionFalla || d.descripcionDesvio || '—'}</span>
          </div>
        </label>
      `).join('')
  } else {
    panelAuto.style.display = 'none'
  }

  // Panel desvíos nuevos (solo si hay fallas)
  const panelDesvios = document.getElementById('panel-desvios-nuevos')
  if (fallas.length > 0) {
    panelDesvios.style.display = 'block'
    document.getElementById('desvios-nuevos-container').innerHTML =
      fallas.map((eq, i) => renderDesvioForm(eq, i)).join('')
    // Escuchar cambios en los campos para habilitar el botón
    document.querySelectorAll('.desvio-field').forEach(el => {
      el.addEventListener('input', checkConfirmarEnabled)
    })
  } else {
    panelDesvios.style.display = 'none'
  }

  // Mostrar panel resultados, ocultar upload
  document.getElementById('panel-upload').style.display    = 'none'
  document.getElementById('panel-resultados').style.display = 'block'

  checkConfirmarEnabled()
}

function renderEquipoCard(eq) {
  const ok = eq.estado === 'correcto'
  return `
    <div class="equipo-card ${ok ? 'equipo-ok' : 'equipo-falla'}">
      <div class="equipo-card-header">
        <span class="equipo-codigo">${eq.codigo || '—'}</span>
        <span class="equipo-estado-badge ${ok ? 'badge-correcto' : 'badge-falla-sm'}">
          ${ok ? '✓ Correcto' : '✗ Falla'}
        </span>
      </div>
      <p class="equipo-desc">${eq.descripcion || ''}</p>
      ${eq.observacion ? `<p class="equipo-obs">⚠ ${eq.observacion}</p>` : ''}
    </div>
  `
}

function renderDesvioForm(eq, i) {
  return `
    <div class="desvio-form-card">
      <div class="desvio-form-title">
        <span class="equipo-codigo">${eq.codigo}</span>
        <span>${eq.descripcion || ''}</span>
        ${eq.observacion ? `<span class="equipo-obs-small">IA: "${eq.observacion}"</span>` : ''}
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Descripción del desvío *</label>
          <textarea class="desvio-field" id="desvio-desc-${i}" rows="2" required
            placeholder="Describí el problema encontrado..."
            data-codigo="${eq.codigo}" data-desc="${eq.descripcion || ''}" data-obs="${eq.observacion || ''}"></textarea>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Acción a implementar *</label>
          <input class="desvio-field" id="desvio-accion-${i}" type="text" required
            placeholder="¿Qué acción correctiva se va a tomar?">
        </div>
        <div class="form-group">
          <label>Fecha estimada de ejecución *</label>
          <input class="desvio-field" id="desvio-fecha-${i}" type="date" required>
        </div>
      </div>
    </div>
  `
}

function checkConfirmarEnabled() {
  const fallas = (analisisActual?.equipos || []).filter(e => e.estado === 'falla')
  const todasCompletas = fallas.every((_, i) => {
    const desc   = document.getElementById(`desvio-desc-${i}`)?.value?.trim()
    const accion = document.getElementById(`desvio-accion-${i}`)?.value?.trim()
    const fecha  = document.getElementById(`desvio-fecha-${i}`)?.value
    return desc && accion && fecha
  })
  document.getElementById('btn-confirmar-guardar').disabled = !todasCompletas
}

function toggleAutoclose(id, checked) {
  if (checked) desviosSeleccionados.add(id)
  else         desviosSeleccionados.delete(id)
}

// ─── PASO 3: Guardar inspección ───────────────────────────────────────────────
document.getElementById('btn-confirmar-guardar')?.addEventListener('click', async () => {
  const fallas = (analisisActual?.equipos || []).filter(e => e.estado === 'falla')

  const desviosNuevos = fallas.map((eq, i) => ({
    codigoEquipo:           eq.codigo,
    descripcionEquipo:      eq.descripcion || '',
    observacionFalla:       eq.observacion  || '',
    descripcionDesvio:      document.getElementById(`desvio-desc-${i}`).value,
    accionImplementar:      document.getElementById(`desvio-accion-${i}`).value,
    fechaEstimadaEjecucion: document.getElementById(`desvio-fecha-${i}`).value
  }))

  const estacionManual = document.getElementById('estacion-manual').value

  const fd = new FormData()
  fd.append('archivo', currentFile)
  fd.append('datos', JSON.stringify({
    analisis:       analisisActual,
    estacion:       estacionManual,
    desviosNuevos,
    desviosCerrar:  [...desviosSeleccionados]
  }))

  const btn = document.getElementById('btn-confirmar-guardar')
  btn.disabled = true
  btn.textContent = 'Guardando...'

  try {
    const result = await apiFormFetch('/inspecciones', fd)
    const msgs = ['Inspección guardada correctamente.']
    if (result.desviosCreados?.length)  msgs.push(`${result.desviosCreados.length} desvío(s) registrado(s).`)
    if (result.desviosCerrados?.length) msgs.push(`${result.desviosCerrados.length} desvío(s) cerrado(s) automáticamente.`)
    showNotification(msgs.join(' '), 'success')
    resetFlujoAnalisis()
    loadKpis()
  } catch (err) {
    showNotification('Error al guardar: ' + err.message, 'error')
    btn.disabled = false
    btn.textContent = 'Confirmar y Guardar'
  }
})

document.getElementById('btn-cancelar-analisis')?.addEventListener('click', resetFlujoAnalisis)

function resetFlujoAnalisis() {
  currentFile          = null
  analisisActual       = null
  desviosCierrePosible = []
  desviosSeleccionados = new Set()

  document.getElementById('analizar-form').reset()
  resetFileVisual()
  document.getElementById('panel-upload').style.display     = 'block'
  document.getElementById('panel-resultados').style.display = 'none'
  const btn = document.getElementById('btn-confirmar-guardar')
  if (btn) { btn.disabled = true; btn.textContent = 'Confirmar y Guardar' }
}

// ─── Vista: Desvíos Pendientes ────────────────────────────────────────────────
async function loadDesviosPendientes() {
  const lista = document.getElementById('desvios-lista')
  lista.innerHTML = '<p class="empty-state">Cargando...</p>'
  try {
    const desvios = await apiFetch('/desvios/pendientes')
    setText('kpi-desvios-abiertos', desvios.length)

    if (desvios.length === 0) {
      lista.innerHTML = `
        <div class="empty-state-card">
          <span style="font-size:2rem">✓</span>
          <p>No hay desvíos pendientes. ¡Todo en orden!</p>
        </div>`
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
          <button class="btn-primary btn-sm" onclick="abrirModalCierre('${d._id}', '${d.codigoEquipo}', '${escHtml(d.descripcionEquipo)}', '${escHtml(d.descripcionDesvio)}')">
            Registrar Cierre
          </button>
        </div>
      </div>
    `).join('')
  } catch (err) {
    lista.innerHTML = `<p class="empty-state" style="color:var(--danger-color)">Error: ${err.message}</p>`
  }
}

// ─── Modal: Cerrar Desvío (manual) ───────────────────────────────────────────
function abrirModalCierre(id, codigo, descripcionEquipo, descripcionDesvio) {
  desvioIdParaCerrar = id
  document.getElementById('modal-desvio-info').innerHTML = `
    <p><strong>${codigo}</strong>${descripcionEquipo ? ' — ' + descripcionEquipo : ''}</p>
    <p style="color:var(--text-secondary);margin-top:4px;font-size:13px">${descripcionDesvio}</p>
  `
  document.getElementById('fecha-cierre-real').value = new Date().toISOString().split('T')[0]
  document.getElementById('eficacia-select').value   = ''
  document.getElementById('modal-cerrar-desvio').style.display = 'flex'
}

document.getElementById('btn-cancelar-cierre')?.addEventListener('click', () => {
  document.getElementById('modal-cerrar-desvio').style.display = 'none'
})

document.getElementById('form-cerrar-desvio')?.addEventListener('submit', async e => {
  e.preventDefault()
  const fechaRealCierre = document.getElementById('fecha-cierre-real').value
  const eficacia        = document.getElementById('eficacia-select').value
  if (!eficacia) { showNotification('Seleccioná la eficacia de la acción.', 'error'); return }

  try {
    await apiFetch(`/desvios/${desvioIdParaCerrar}/cerrar`, {
      method: 'PUT',
      body: JSON.stringify({ fechaRealCierre, eficacia })
    })
    showNotification('Desvío cerrado exitosamente.', 'success')
    document.getElementById('modal-cerrar-desvio').style.display = 'none'
    loadDesviosPendientes()
    loadKpis()
  } catch (err) {
    showNotification('Error al cerrar: ' + err.message, 'error')
  }
})

// ─── Utilidades ──────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return dateStr }
}

function escHtml(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;')
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadKpis()
