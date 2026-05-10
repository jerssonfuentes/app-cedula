/* =============================================
   SIVE – app.js
   Lógica: parseo de cédula + llamadas al Apps Script
   ============================================= */

// 🔧 REEMPLAZA ESTA URL CON TU URL DE APPS SCRIPT DESPLEGADO
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxBLrsFOQcskc1V6CmtzxZVhgsZXNXrHSvK_tSxI7MMGF191fLU3D9XOI6bMbWfQB3Dtw/exec";

// Estado global
let currentMode     = 'nueva';   // 'nueva' | 'antigua' | 'sindoc'
let currentScanTab  = 'camera';  // 'camera' | 'manual'
let currentData     = null;
let html5QrCode     = null;
let cameraRunning   = false;
let countToday      = 0;
let countTotal      = 0;
let toastTimer      = null;

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  checkConnection();
  loadRecent();

  // Enter en el input de texto activa parseo
  document.getElementById('barcodeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') parseBarcode();
  });
});

// ── SELECCIÓN DE MODO ─────────────────────────────────────────
function selectMode(mode) {
  // Si había cámara corriendo, detenerla
  if (cameraRunning) stopCamera();

  currentMode = mode;

  // Actualizar botones
  ['nueva','antigua','sindoc'].forEach(m => {
    document.getElementById('mode' + m.charAt(0).toUpperCase() + m.slice(1))
      .classList.toggle('active', m === mode);
  });

  const scannerSection = document.getElementById('scannerSection');
  const manualSection  = document.getElementById('manualSection');
  const dataCard       = document.getElementById('dataCard');
  dataCard.style.display = 'none';
  currentData = null;

  if (mode === 'sindoc') {
    scannerSection.style.display = 'none';
    manualSection.style.display  = '';
  } else {
    scannerSection.style.display = '';
    manualSection.style.display  = 'none';
    document.getElementById('scannerTitle').textContent =
      mode === 'nueva' ? 'Escanear Cédula Nueva (PDF417)' : 'Escanear Cédula Antigua (Código 39)';
    // Auto-arrancar cámara si el tab activo es cámara
    if (currentScanTab === 'camera') {
      setTimeout(startCamera, 300);
    }
  }
}

// ── TABS ESCÁNER ──────────────────────────────────────────────
function switchScanTab(tab) {
  currentScanTab = tab;
  document.getElementById('tabCamera').classList.toggle('active', tab === 'camera');
  document.getElementById('tabManual').classList.toggle('active', tab === 'manual');
  document.getElementById('panelCamera').style.display = tab === 'camera' ? '' : 'none';
  document.getElementById('panelManual').style.display = tab === 'manual' ? '' : 'none';

  if (tab === 'manual') {
    if (cameraRunning) stopCamera();
    setTimeout(() => document.getElementById('barcodeInput').focus(), 100);
  } else {
    startCamera();
  }
}

// ── CÁMARA ────────────────────────────────────────────────────
function startCamera() {
  if (cameraRunning) return;

  const startBtn = document.getElementById('btnStartCam');
  const stopBtn  = document.getElementById('btnStopCam');

  // Verificar soporte
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('⚠️ Tu navegador no soporta acceso a la cámara. Usa la pestaña Lector/Texto.', 'error');
    return;
  }

  startBtn.style.display = 'none';
  startBtn.textContent   = 'Iniciando…';

  try {
    html5QrCode = new Html5Qrcode('qr-reader');

    const config = {
      fps: 10,
      qrbox: { width: 280, height: 180 },
      aspectRatio: 1.6,
      // Formatos relevantes para cédula colombiana
      formatsToSupport: [
        Html5QrcodeSupportedFormats.PDF_417,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX
      ]
    };

    html5QrCode.start(
      { facingMode: 'environment' },  // Cámara trasera
      config,
      onScanSuccess,
      onScanError
    ).then(() => {
      cameraRunning = true;
      stopBtn.style.display = '';
      showToast('📷 Cámara activa — apunta al código de barras', '');
    }).catch(err => {
      cameraRunning = false;
      startBtn.style.display = '';
      startBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Activar Cámara`;
      if (err.toString().includes('Permission') || err.toString().includes('NotAllowed')) {
        showToast('🚫 Permiso de cámara denegado. Actívalo en la configuración del navegador.', 'error');
      } else {
        showToast('⚠️ No se pudo acceder a la cámara. Usa la pestaña Lector/Texto.', 'error');
      }
    });
  } catch (e) {
    startBtn.style.display = '';
    showToast('Error iniciando cámara: ' + e.message, 'error');
  }
}

function stopCamera() {
  if (!html5QrCode || !cameraRunning) return;
  html5QrCode.stop().then(() => {
    cameraRunning = false;
    document.getElementById('btnStartCam').style.display = '';
    document.getElementById('btnStopCam').style.display  = 'none';
    document.getElementById('btnStartCam').innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Activar Cámara`;
  }).catch(() => {});
}

function onScanSuccess(decodedText) {
  // Detener la cámara tras leer
  stopCamera();
  // Procesar el código leído
  const data = processCode(decodedText);
  if (data) {
    currentData = data;
    fillForm(data);
    document.getElementById('dataCard').style.display = '';
    document.getElementById('dataCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('✓ Código leído correctamente', 'success');
  } else {
    showToast('❌ Código leído pero no se reconoció el formato. Intenta de nuevo.', 'error');
    // Reiniciar cámara automáticamente
    setTimeout(startCamera, 1500);
  }
}

function onScanError() {
  // Silencioso — ocurre en cada frame sin código
}

// ── PARSEO MANUAL (input de texto) ───────────────────────────
function parseBarcode() {
  const raw = document.getElementById('barcodeInput').value.trim();
  if (!raw) { showToast('Ingresa o escanea un código primero.', 'error'); return; }

  const data = processCode(raw);
  if (data) {
    currentData = data;
    fillForm(data);
    document.getElementById('dataCard').style.display = '';
    document.getElementById('dataCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('✓ Código procesado correctamente', 'success');
  } else {
    showToast('❌ No se reconoció el formato. Verifica el código.', 'error');
  }
}

// ── PROCESADOR CENTRAL ────────────────────────────────────────
function processCode(raw) {
  if (currentMode === 'nueva' || currentMode === 'antigua') {
    // Intentar cédula nueva primero, luego antigua
    return parseCedulaNueva(raw) || parseCedulaAntigua(raw);
  }
  return null;
}

// ── CÉDULA NUEVA – PDF417 ─────────────────────────────────────
function parseCedulaNueva(raw) {
  const separators = /[;|\t]/;
  const parts = raw.split(separators).map(p => p.trim());
  if (parts.length < 4) return null;

  let startIdx = 0;
  if (/^[A-Z]{2,3}$/.test(parts[0])) startIdx = 1;

  let cedula = '', apellido1 = '', apellido2 = '', nombre1 = '', nombre2 = '';
  let fechaNac = '', genero = '', fechaExp = '', lugarExp = '';

  if (/^\d{6,12}$/.test(parts[startIdx])) {
    cedula    = parts[startIdx];
    apellido1 = parts[startIdx + 1] || '';
    apellido2 = parts[startIdx + 2] || '';
    nombre1   = parts[startIdx + 3] || '';
    nombre2   = parts[startIdx + 4] || '';
    fechaNac  = formatFecha(parts[startIdx + 5] || '');
    genero    = mapGenero(parts[startIdx + 6] || '');
    fechaExp  = formatFecha(parts[startIdx + 7] || '');
    lugarExp  = parts[startIdx + 8] || '';
  } else {
    for (let i = 0; i < parts.length; i++) {
      if (/^\d{6,12}$/.test(parts[i])) {
        cedula    = parts[i];
        apellido1 = parts[i + 1] || '';
        apellido2 = parts[i + 2] || '';
        nombre1   = parts[i + 3] || '';
        nombre2   = parts[i + 4] || '';
        fechaNac  = formatFecha(parts[i + 5] || '');
        genero    = mapGenero(parts[i + 6] || '');
        fechaExp  = formatFecha(parts[i + 7] || '');
        lugarExp  = parts[i + 8] || '';
        break;
      }
    }
  }

  if (!cedula || !apellido1) return null;
  return { tipo: 'NUEVA (PDF417)', cedula, apellido1, apellido2, nombre1, nombre2, fechaNac, genero, fechaExp, lugarExp };
}

// ── CÉDULA ANTIGUA – Código 39 ────────────────────────────────
function parseCedulaAntigua(raw) {
  const clean = raw.replace(/[\s\-\.]/g, '');
  if (/^\d{6,12}$/.test(clean)) {
    return { tipo: 'ANTIGUA (Código 39)', cedula: clean, apellido1: '', apellido2: '', nombre1: '', nombre2: '', fechaNac: '', genero: '', fechaExp: '', lugarExp: '' };
  }
  const match = clean.match(/^[A-Z]{1,3}(\d{6,12})$/i);
  if (match) {
    return { tipo: 'ANTIGUA (Código 39)', cedula: match[1], apellido1: '', apellido2: '', nombre1: '', nombre2: '', fechaNac: '', genero: '', fechaExp: '', lugarExp: '' };
  }
  return null;
}

// ── REGISTRO MANUAL (sin documento) ──────────────────────────
function buildManualData() {
  const apellido1 = document.getElementById('mApellido1').value.trim();
  const nombre1   = document.getElementById('mNombre1').value.trim();

  if (!apellido1 || !nombre1) {
    showToast('⚠️ Primer apellido y primer nombre son obligatorios.', 'error');
    return;
  }

  const docAlt   = document.getElementById('mDocAlt').value.trim();
  const fechaNac = document.getElementById('mFechaNac').value;

  currentData = {
    tipo:      'SIN DOCUMENTO',
    cedula:    docAlt || 'S/D-' + Date.now(),
    apellido1,
    apellido2: document.getElementById('mApellido2').value.trim(),
    nombre1,
    nombre2:   document.getElementById('mNombre2').value.trim(),
    fechaNac:  fechaNac ? fechaNac.split('-').reverse().join('/') : '',
    genero:    document.getElementById('mGenero').value,
    fechaExp:  '',
    lugarExp:  ''
  };

  fillForm(currentData);
  document.getElementById('dataCard').style.display = '';
  document.getElementById('dataCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast('✓ Datos cargados — completa la información SIVE', 'success');
}

// ── LLENAR FORMULARIO ─────────────────────────────────────────
function fillForm(d) {
  document.getElementById('fCedula').textContent    = d.cedula    || '—';
  document.getElementById('fApellido1').textContent = d.apellido1 || '—';
  document.getElementById('fApellido2').textContent = d.apellido2 || '—';
  document.getElementById('fNombre1').textContent   = d.nombre1   || '—';
  document.getElementById('fNombre2').textContent   = d.nombre2   || '—';
  document.getElementById('fFechaNac').textContent  = d.fechaNac  || '—';
  document.getElementById('fGenero').textContent    = d.genero    || '—';
  document.getElementById('fFechaExp').textContent  = d.fechaExp  || '—';
  document.getElementById('fLugarExp').textContent  = d.lugarExp  || '—';

  const badge = document.getElementById('badgeTipo');
  badge.textContent = d.tipo;
  if (d.tipo === 'SIN DOCUMENTO') {
    badge.style.cssText = 'background:#fff3e0;color:#e65100;border-color:rgba(230,81,0,.3)';
  } else if (d.tipo.includes('ANTIGUA')) {
    badge.style.cssText = 'background:#e8f5e9;color:#2e7d32;border-color:rgba(46,125,50,.3)';
  } else {
    badge.style.cssText = '';
  }
}

// ── GUARDAR EN SHEETS ─────────────────────────────────────────
async function saveRecord() {
  if (!currentData) return;

  const programa = document.getElementById('fPrograma').value.trim();
  if (!programa) {
    showToast('⚠️ El campo Programa / Carrera es obligatorio.', 'error');
    document.getElementById('fPrograma').focus();
    return;
  }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = 'Guardando…';

  const payload = {
    action:        'save',
    cedula:        currentData.cedula,
    apellido1:     currentData.apellido1,
    apellido2:     currentData.apellido2,
    nombre1:       currentData.nombre1,
    nombre2:       currentData.nombre2,
    fechaNac:      currentData.fechaNac,
    genero:        currentData.genero,
    fechaExp:      currentData.fechaExp,
    lugarExp:      currentData.lugarExp,
    tipo:          currentData.tipo,
    programa,
    semestre:      document.getElementById('fSemestre').value.trim(),
    jornada:       document.getElementById('fJornada').value,
    observaciones: document.getElementById('fObservaciones').value.trim(),
    fechaRegistro: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
  };

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      mode: 'cors'
    });
    const json = await res.json();

    if (json.status === 'ok') {
      showToast('✅ Registro guardado en Google Sheets', 'success');
      countToday++;
      countTotal++;
      document.getElementById('countToday').textContent = countToday;
      document.getElementById('countTotal').textContent = countTotal;
      clearAll();
      loadRecent();
    } else {
      throw new Error(json.message || 'Error desconocido');
    }
  } catch (err) {
    showToast('❌ Error al guardar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar en Sheets`;
  }
}

// ── REGISTROS RECIENTES ───────────────────────────────────────
async function loadRecent() {
  const tbody = document.getElementById('recentBody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Cargando…</td></tr>';
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=getRecent&limit=10', { mode: 'cors' });
    const json = await res.json();

    if (!json.rows || json.rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Sin registros aún.</td></tr>';
      return;
    }
    countTotal = json.total || json.rows.length;
    document.getElementById('countTotal').textContent = countTotal;

    tbody.innerHTML = json.rows.map((r, i) => `
      <tr class="${i === 0 ? 'row-new' : ''}">
        <td>${r.cedula || '—'}</td>
        <td>${[r.apellido1, r.apellido2, r.nombre1, r.nombre2].filter(Boolean).join(' ') || '—'}</td>
        <td>${r.programa || '—'}</td>
        <td>${r.tipo ? r.tipo.split(' ')[0] : '—'}</td>
        <td>${r.fechaRegistro || '—'}</td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No se pudo cargar. Verifica la conexión.</td></tr>';
  }
}

// ── LIMPIAR TODO ──────────────────────────────────────────────
function clearAll() {
  currentData = null;
  document.getElementById('barcodeInput').value = '';
  document.getElementById('fPrograma').value    = '';
  document.getElementById('fSemestre').value    = '';
  document.getElementById('fJornada').value     = '';
  document.getElementById('fObservaciones').value = '';
  // Limpiar manual
  ['mDocAlt','mApellido1','mApellido2','mNombre1','mNombre2','mFechaNac'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('mGenero').value = '';
  document.getElementById('dataCard').style.display = 'none';
  // Si estamos en modo cámara, reactivarla
  if (currentScanTab === 'camera' && currentMode !== 'sindoc') {
    setTimeout(startCamera, 400);
  }
}

// ── CONEXIÓN ──────────────────────────────────────────────────
async function checkConnection() {
  const pill = document.getElementById('statusPill');
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=ping', { mode: 'cors' });
    if (res.ok) {
      pill.textContent = '⬤ Conectado';
      pill.classList.add('online');
    } else throw new Error();
  } catch {
    pill.textContent = '⬤ Sin conexión';
    pill.classList.add('offline');
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function formatFecha(str) {
  if (!str) return '';
  const s = str.replace(/\D/g, '');
  if (s.length === 8) return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`;
  return str;
}

function mapGenero(g) {
  const up = g.toUpperCase().trim();
  if (up === 'M' || up === 'MASCULINO' || up === '1') return 'Masculino';
  if (up === 'F' || up === 'FEMENINO'  || up === '2') return 'Femenino';
  return g;
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3800);
}