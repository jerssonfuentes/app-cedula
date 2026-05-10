/* =============================================
   SIVE – app.js
   Lógica: parseo de cédula + llamadas al Apps Script
   ============================================= */

// 🔧 REEMPLAZA ESTA URL CON TU URL DE APPS SCRIPT DESPLEGADO
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxBLrsFOQcskc1V6CmtzxZVhgsZXNXrHSvK_tSxI7MMGF191fLU3D9XOI6bMbWfQB3Dtw/exec";

// Estado local
let currentData = null;
let countToday   = 0;
let countTotal   = 0;

// ── Al cargar la página ─────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  checkConnection();
  loadRecent();
  // Auto-focus en el input para lectores de barcode físicos
  document.getElementById('barcodeInput').focus();

  // Enter activa parseo
  document.getElementById('barcodeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') parseBarcode();
  });
});

// ── CONEXIÓN ────────────────────────────────────────────────────
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

// ── PARSEO DE CÓDIGO DE BARRAS ──────────────────────────────────
function parseBarcode() {
  const raw = document.getElementById('barcodeInput').value.trim();
  if (!raw) { showToast('Ingresa o escanea un código primero.', 'error'); return; }

  let data = null;

  // Intentar PDF417 (cédula nueva) primero
  data = parseCedulaNueva(raw);

  // Si falla, intentar cédula antigua (Código 39 / texto)
  if (!data) data = parseCedulaAntigua(raw);

  if (!data) {
    showToast('❌ No se reconoció el formato. Verifica el código.', 'error');
    animateFrame('error');
    return;
  }

  currentData = data;
  fillForm(data);
  animateFrame('success');
  document.getElementById('dataCard').style.display = '';
  document.getElementById('dataCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast('✓ Código leído correctamente', 'success');
}

/* ─────────────────────────────────────────────────────────────────
   CÉDULA NUEVA – PDF417
   Formato oficial RNEC Colombia (Registraduría Nacional):
   Los campos vienen separados por punto y coma o caracteres especiales.
   Orden típico (puede variar ligeramente según año de emisión):
   0: Número cédula
   1: Primer apellido
   2: Segundo apellido
   3: Primer nombre
   4: Segundo nombre
   5: Fecha nacimiento (AAAAMMDD o similar)
   6: Género (M/F)
   7: Fecha expedición
   8: Lugar expedición
   ───────────────────────────────────────────────────────────────── */
function parseCedulaNueva(raw) {
  // Separadores comunes en PDF417 cédula colombiana
  const separators = /[;|\t]/;
  const parts = raw.split(separators).map(p => p.trim());

  // Necesitamos al menos número + apellido + nombre
  if (parts.length < 4) return null;

  // El primer campo con solo dígitos es el número de cédula
  // A veces viene primero, a veces en otra posición
  let cedula = '', apellido1 = '', apellido2 = '', nombre1 = '', nombre2 = '';
  let fechaNac = '', genero = '', fechaExp = '', lugarExp = '';

  // Detectar si el número de cédula está al inicio o hay prefijos
  let startIdx = 0;
  if (/^[A-Z]{2,3}$/.test(parts[0])) startIdx = 1; // Skip country code

  const maybeCedula = parts[startIdx];
  if (/^\d{6,12}$/.test(maybeCedula)) {
    cedula    = maybeCedula;
    apellido1 = parts[startIdx + 1] || '';
    apellido2 = parts[startIdx + 2] || '';
    nombre1   = parts[startIdx + 3] || '';
    nombre2   = parts[startIdx + 4] || '';
    fechaNac  = formatFecha(parts[startIdx + 5] || '');
    genero    = mapGenero(parts[startIdx + 6] || '');
    fechaExp  = formatFecha(parts[startIdx + 7] || '');
    lugarExp  = parts[startIdx + 8] || '';
  } else {
    // Buscar número de cédula en cualquier posición
    for (let i = 0; i < parts.length; i++) {
      if (/^\d{6,12}$/.test(parts[i])) {
        cedula = parts[i];
        // Asumir apellidos y nombres en posiciones siguientes
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

/* ─────────────────────────────────────────────────────────────────
   CÉDULA ANTIGUA – Código 39 / texto plano
   La cédula antigua generalmente tiene solo el número de cédula
   en el código de barras (Código 39), a veces con un prefijo de ciudad.
   Ejemplo: "12345678" o "C 12345678"
   ───────────────────────────────────────────────────────────────── */
function parseCedulaAntigua(raw) {
  // Limpiar espacios y guiones
  const clean = raw.replace(/[\s\-\.]/g, '');

  // Patrón: solo dígitos (6 a 12)
  if (/^\d{6,12}$/.test(clean)) {
    return {
      tipo:      'ANTIGUA (Código 39)',
      cedula:    clean,
      apellido1: '',
      apellido2: '',
      nombre1:   '',
      nombre2:   '',
      fechaNac:  '',
      genero:    '',
      fechaExp:  '',
      lugarExp:  ''
    };
  }

  // Patrón: prefijo letras + dígitos (ej: "C12345678", "CC12345678")
  const match = clean.match(/^[A-Z]{1,3}(\d{6,12})$/i);
  if (match) {
    return {
      tipo:      'ANTIGUA (Código 39)',
      cedula:    match[1],
      apellido1: '', apellido2: '', nombre1: '', nombre2: '',
      fechaNac:  '', genero:    '', fechaExp: '', lugarExp: ''
    };
  }

  return null;
}

// ── HELPERS ─────────────────────────────────────────────────────
function formatFecha(str) {
  if (!str) return '';
  const s = str.replace(/\D/g, '');
  if (s.length === 8) {
    // AAAAMMDD
    return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`;
  }
  return str;
}

function mapGenero(g) {
  const up = g.toUpperCase().trim();
  if (up === 'M' || up === 'MASCULINO' || up === '1') return 'Masculino';
  if (up === 'F' || up === 'FEMENINO'  || up === '2') return 'Femenino';
  return g;
}

// ── LLENAR FORMULARIO ───────────────────────────────────────────
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
  document.getElementById('badgeTipo').textContent  = d.tipo;
}

// ── GUARDAR EN GOOGLE SHEETS ────────────────────────────────────
async function saveRecord() {
  if (!currentData) return;

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Guardando…';

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
    programa:      document.getElementById('fPrograma').value.trim(),
    semestre:      document.getElementById('fSemestre').value.trim(),
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
      showToast('✓ Registro guardado en Google Sheets', 'success');
      countToday++;
      countTotal++;
      document.getElementById('countToday').textContent = countToday;
      document.getElementById('countTotal').textContent = countTotal;
      clearForm();
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

// ── CARGAR REGISTROS RECIENTES ──────────────────────────────────
async function loadRecent() {
  const tbody = document.getElementById('recentBody');
  tbody.innerHTML = '<tr><td colspan="4" class="empty-row">Cargando…</td></tr>';

  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=getRecent&limit=10', { mode: 'cors' });
    const json = await res.json();

    if (!json.rows || json.rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-row">Sin registros aún.</td></tr>';
      return;
    }

    countTotal = json.total || json.rows.length;
    document.getElementById('countTotal').textContent = countTotal;

    tbody.innerHTML = json.rows.map((r, i) => `
      <tr class="${i === 0 ? 'row-new' : ''}">
        <td>${r.cedula || '—'}</td>
        <td>${[r.apellido1, r.apellido2, r.nombre1, r.nombre2].filter(Boolean).join(' ') || '—'}</td>
        <td>${r.programa || '—'}</td>
        <td>${r.fechaRegistro || '—'}</td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No se pudo cargar. Verifica la conexión.</td></tr>';
  }
}

// ── LIMPIAR ─────────────────────────────────────────────────────
function clearForm() {
  currentData = null;
  document.getElementById('barcodeInput').value = '';
  document.getElementById('fPrograma').value = '';
  document.getElementById('fSemestre').value = '';
  document.getElementById('fObservaciones').value = '';
  document.getElementById('dataCard').style.display = 'none';
  document.getElementById('barcodeInput').focus();
}

// ── ANIMACIÓN FRAME ─────────────────────────────────────────────
function animateFrame(state) {
  const frame = document.getElementById('scanFrame');
  frame.classList.add('active');
  setTimeout(() => frame.classList.remove('active'), 1200);
}

// ── TOAST ────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
}