/* Estudio Creativo — elegir programa, estilo (rosa + bordes de colores) y actualizaciones */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const VER = window.ESTUDIO_VERSION || '0';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- Estilo ---------- */
const TONOS = {
  chicle:   {n:'Chicle',      a:'#ffd1e6', b:'#ff9cc7', acc:'#e0307f', ink:'#4a1030', soft:'#7a3a5c'},
  pastel:   {n:'Pastel',      a:'#ffe6f1', b:'#ffc4dd', acc:'#d6457f', ink:'#4a1030', soft:'#7a3a5c'},
  fucsia:   {n:'Fucsia',      a:'#ffb0d6', b:'#ff5fae', acc:'#b3125a', ink:'#3d0a24', soft:'#6b1d44'},
  viejo:    {n:'Rosa viejo',  a:'#f6d9e1', b:'#d9a1b4', acc:'#a8456b', ink:'#3f1426', soft:'#6e3a50'},
  melocoton:{n:'Melocotón',   a:'#ffe3d8', b:'#ffa9b8', acc:'#d9405a', ink:'#4a1420', soft:'#7a3a46'}
};
const SWATCHES = ['#ff4fa0','#ff2d55','#ff7a45','#ffb000','#ffe14a','#a6e22e','#4ddc6a','#18b56a',
                  '#2bd4c0','#19b6e8','#3aa0ff','#3b5bff','#7a5cff','#b45cff','#ff4fd8','#ff9ad5',
                  '#ffffff','#f1d9ff','#c9f0ff','#d5ffe0','#fff0a8','#ffc7a8','#222222','#8a8a8a'];
const MODOS = {
  arcoiris: ['Arcoíris que gira',   'Todos los colores del arcoíris dando vueltas (tus colores se usan en los otros bordes).'],
  degradado:['Mis colores girando', 'Un degradado con tus colores que da vueltas.'],
  parpadeo: ['Parpadeo',            'Salta de un color a otro, de uno en uno.'],
  latido:   ['Latido',              'Tu primer color late con un brillo suave.'],
  fijo:     ['Fijo',                'Un solo color, quieto.']
};
const PRESETS = [
  {n:'Caramelo',  modo:'degradado', colores:['#ff4fa0','#ffb000','#ffffff','#ff4fa0']},
  {n:'Arcoíris',  modo:'arcoiris',  colores:['#ff4fa0']},
  {n:'Neón',      modo:'parpadeo',  colores:['#19f0ff','#ff2bd6','#fff200','#7cff3a']},
  {n:'Océano',    modo:'degradado', colores:['#19b6e8','#2bd4c0','#3b5bff','#b45cff']},
  {n:'Atardecer', modo:'degradado', colores:['#ff2d55','#ff7a45','#ffb000','#b45cff']},
  {n:'Menta',     modo:'latido',    colores:['#18b56a']},
  {n:'Dorado',    modo:'fijo',      colores:['#ffb000']}
];
const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEF = {tono:'chicle', modo:'arcoiris', colores:['#ff4fa0','#ffb000','#2bd4c0','#7a5cff'], vel:5, grosor:3, brillo:true, mov:!reducido, activo:0};
let T = cargarTema();
function cargarTema(){
  try {
    const s = JSON.parse(localStorage.getItem('estudio.tema') || 'null');
    if (s && typeof s === 'object') {
      const t = {...DEF, ...s};
      if (!TONOS[t.tono]) t.tono = DEF.tono;
      if (!MODOS[t.modo]) t.modo = DEF.modo;
      t.colores = (Array.isArray(t.colores) ? t.colores : []).filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6);
      if (!t.colores.length) t.colores = DEF.colores.slice();
      t.vel = Math.min(10, Math.max(1, +t.vel || 5)); t.grosor = Math.min(9, Math.max(2, +t.grosor || 3));
      t.activo = Math.min(t.colores.length - 1, Math.max(0, t.activo | 0));
      return t;
    }
  } catch (e) {}
  return {...DEF, colores: DEF.colores.slice()};
}
function guardarTema(){ try { localStorage.setItem('estudio.tema', JSON.stringify(T)); } catch (e) {} }

function aplicarTema(){
  const r = document.documentElement, to = TONOS[T.tono];
  r.style.setProperty('--bg1', to.a); r.style.setProperty('--bg2', to.b); r.style.setProperty('--accent', to.acc);
  r.style.setProperty('--ink', to.ink); r.style.setProperty('--soft', to.soft);
  const cs = T.colores, n = cs.length;
  for (let i = 0; i < 6; i++) r.style.setProperty('--c' + (i + 1), cs[i % n]);
  r.style.setProperty('--ew', T.grosor + 'px');
  r.style.setProperty('--grad', 'conic-gradient(from var(--ang), ' + (n > 1 ? cs.join(', ') + ', ' + cs[0] : cs[0] + ', ' + cs[0]) + ')');
  // Velocidad 1 (lenta) … 10 (rápida): segundos por vuelta
  const vel = 11 - T.vel;                       // 10 s … 1 s
  r.style.setProperty('--vel', vel.toFixed(1) + 's');
  // El parpadeo nunca pasa de ~3 cambios por segundo (cuida a quien mire)
  const pasos = n === 1 ? 2 : n;
  const ciclo = Math.max(vel * 0.5, pasos * 0.36);
  r.style.setProperty('--cycle', ciclo.toFixed(2) + 's');
  let kf = '@keyframes edgeblink{';
  if (n === 1) kf += `0%{background:${cs[0]}}50%{background:${cs[0]}33}`;
  else cs.forEach((c, i) => { kf += `${(i * 100 / n).toFixed(2)}%{background:${c}}`; });
  kf += '}';
  let st = $('#dyn'); if (!st) { st = document.createElement('style'); st.id = 'dyn'; document.head.appendChild(st); }
  st.textContent = kf;
  r.dataset.modo = T.modo; r.dataset.mov = T.mov ? '1' : '0'; r.dataset.brillo = T.brillo ? '1' : '0';
  const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = to.a;
}

function pintarPanel(){
  $('#pTonos').innerHTML = Object.entries(TONOS).map(([k, t]) =>
    `<button class="tono" type="button" data-tono="${k}" title="${t.n}" aria-label="${t.n}" aria-pressed="${T.tono === k}" style="background:linear-gradient(135deg,${t.a},${t.b})"></button>`).join('');
  $('#pModos').innerHTML = Object.entries(MODOS).map(([k, m]) =>
    `<button class="opt" type="button" data-modo="${k}" aria-pressed="${T.modo === k}">${m[0]}</button>`).join('');
  $('#pModoHint').textContent = MODOS[T.modo][1];
  $('#pChips').innerHTML = T.colores.map((c, i) =>
    `<button class="chipc" type="button" data-i="${i}" aria-pressed="${T.activo === i}" aria-label="Color ${i + 1}" style="background:${c}">${T.colores.length > 1 ? `<span class="q" data-q="${i}" title="Quitar este color">✕</span>` : ''}</button>`).join('') +
    (T.colores.length < 6 ? '<button class="chipc mas" type="button" id="pMas" title="Añadir un color" aria-label="Añadir un color">+</button>' : '');
  $('#pSwatches').innerHTML = SWATCHES.map(c => `<button class="sw" type="button" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  $('#pCustom').value = T.colores[T.activo];
  $('#pVel').value = T.vel; $('#pGrosor').value = T.grosor;
  $('#pBrillo').checked = T.brillo; $('#pMov').checked = T.mov;
  $('#pPresets').innerHTML = PRESETS.map((p, i) => `<button class="opt" type="button" data-p="${i}">${p.n}</button>`).join('');
}
function cambio(){ guardarTema(); aplicarTema(); pintarPanel(); }

function montarPanel(){
  const panel = $('#panel');
  const abrir = on => { panel.hidden = !on; $('#bStyle').setAttribute('aria-expanded', on); if (on) pintarPanel(); };
  $('#bStyle').onclick = () => abrir(panel.hidden);
  $('#pClose').onclick = () => abrir(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) abrir(false); });
  panel.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tono) { T.tono = t.dataset.tono; cambio(); }
    else if (t.dataset.modo) { T.modo = t.dataset.modo; cambio(); }
    else if (t.dataset.c) { T.colores[T.activo] = t.dataset.c; cambio(); }
    else if (t.dataset.p) { const p = PRESETS[+t.dataset.p]; T.modo = p.modo; T.colores = p.colores.slice(); T.activo = 0; if (!reducido) T.mov = true; cambio(); }
    else if (t.id === 'pMas') { const usados = new Set(T.colores); T.colores.push(SWATCHES.find(c => !usados.has(c)) || '#ff4fa0'); T.activo = T.colores.length - 1; cambio(); }
    else if (t.dataset.i !== undefined) {
      if (e.target.dataset.q !== undefined) { T.colores.splice(+e.target.dataset.q, 1); T.activo = Math.min(T.activo, T.colores.length - 1); }
      else T.activo = +t.dataset.i;
      cambio();
    }
  });
  $('#pCustom').addEventListener('input', e => { T.colores[T.activo] = e.target.value; guardarTema(); aplicarTema(); const chip = $('#pChips').children[T.activo]; if (chip) chip.style.background = e.target.value; });
  $('#pVel').addEventListener('input', e => { T.vel = +e.target.value; guardarTema(); aplicarTema(); });
  $('#pGrosor').addEventListener('input', e => { T.grosor = +e.target.value; guardarTema(); aplicarTema(); });
  $('#pBrillo').addEventListener('change', e => { T.brillo = e.target.checked; guardarTema(); aplicarTema(); });
  $('#pMov').addEventListener('change', e => { T.mov = e.target.checked; guardarTema(); aplicarTema(); });
  $('#pReset').onclick = () => { T = {...DEF, colores: DEF.colores.slice()}; cambio(); toast('Estilo restablecido'); };
}

/* ---------- Avisos ---------- */
let toastT = 0;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
function banner(html, botones){
  const b = $('#banner'); b.hidden = !html; if (!html) return;
  b.innerHTML = `<span>${html}</span>` + (botones || []).map((x, i) => `<button type="button" class="${x[2] ? 'go' : ''}" data-b="${i}">${x[0]}</button>`).join('');
  b.onclick = e => { const i = e.target.dataset.b; if (i !== undefined) botones[i][1](); };
}

/* ---------- Programas ---------- */
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; };
const canSW = 'serviceWorker' in navigator;
const abs = u => new URL(u, location.href).href;
// getRegistration devuelve la del Estudio (scope «/») si la app aún no tiene la suya: solo vale la que tenga EXACTAMENTE el scope de la app
async function regDe(a){ try { const r = await navigator.serviceWorker.getRegistration(abs(a.url)); return r && r.scope === abs(a.url) ? r : null; } catch (e) { return null; } }
let APPS = [];
const EST = {};   // id -> {reg, instalada, ultima, notas, estado}

function pintarTarjetas(){
  $('#cards').innerHTML = APPS.map(a => `
    <article class="card edge" id="card-${a.id}">
      <div class="top">
        <img class="ico" src="${esc(a.icono)}" alt="" width="72" height="72" onerror="this.style.visibility='hidden'">
        <div><h2>${esc(a.nombre)}</h2><p class="lema">${esc(a.lema)}</p></div>
      </div>
      <p class="det">${esc(a.detalle)}</p>
      <div class="estado" id="est-${a.id}"><span class="chip">Comprobando…</span></div>
      <div class="btns"><a class="abrir" href="${esc(a.url)}">Abrir ${esc(a.nombre)}</a><span id="upd-${a.id}"></span></div>
      <details id="nov-${a.id}" hidden><summary>¿Qué hay de nuevo?</summary><ul></ul></details>
    </article>`).join('');
}
function pintarEstado(a){
  const e = EST[a.id], box = $('#est-' + a.id), upd = $('#upd-' + a.id), nov = $('#nov-' + a.id);
  if (!box) return;
  let h = '', btn = '';
  const v = e.instalada || e.ultima;
  if (e.estado === 'buscando') h = '<span class="chip">Comprobando…</span>';
  else if (e.estado === 'actualizando') h = '<span class="chip nueva">Actualizando…</span>';
  else if (e.estado === 'sin') h = `<span class="chip err">No se pudo comprobar</span><span class="muted">${e.instalada ? 'Tienes la versión ' + esc(e.instalada) : 'Mira que haya internet'}</span>`;
  else if (e.instalada && e.ultima && cmp(e.instalada, e.ultima) < 0) {
    h = `<span class="chip nueva">Versión nueva: ${esc(e.ultima)}</span><span class="muted">Tienes la ${esc(e.instalada)}</span>`;
    btn = '<button class="upd" type="button">Actualizar</button>';
  } else if (!e.instalada) h = `<span class="chip">Preparándola para usar sin internet…</span>`;
  else h = `<span class="chip ok">✓ Al día</span><span class="muted">Versión ${esc(v)}</span>`;
  box.innerHTML = h; upd.innerHTML = btn;
  const b = upd.querySelector('button'); if (b) b.onclick = () => actualizarApp(a);
  if (e.notas && e.notas.length) { nov.hidden = false; nov.querySelector('ul').innerHTML = e.notas.map(n => `<li>${esc(n)}</li>`).join(''); nov.querySelector('summary').textContent = '¿Qué hay de nuevo en la ' + (e.ultima || '') + '?'; }
}
async function versionInstalada(a, reg){
  try {
    const claves = (await caches.keys()).filter(k => k.startsWith(a.cache)).map(k => k.slice(a.cache.length)).sort(cmp);
    if (!claves.length) return null;
    return reg && reg.waiting && claves.length > 1 ? claves[0] : claves[claves.length - 1];
  } catch (e) { return null; }
}
async function esperarActiva(reg, ms){
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (reg.active && !reg.installing) return true;
    await sleep(300);
  }
  return !!reg.active;
}
async function revisar(a, registrar){
  const e = EST[a.id] = EST[a.id] || {};
  e.estado = 'buscando'; pintarEstado(a);
  let reg = null;
  if (canSW) {
    reg = await regDe(a);
    if (!reg && registrar) { try { reg = await navigator.serviceWorker.register(a.url + 'sw.js', {scope: a.url}); } catch (err) {} }
    if (reg && !reg.active) await esperarActiva(reg, 20000);
  }
  e.reg = reg;
  let remoto = null;
  try { const r = await fetch(a.version + '?x=' + Date.now(), {cache: 'no-store'}); if (r.ok) remoto = await r.json(); } catch (err) {}
  e.ultima = remoto && remoto.version || null; e.notas = remoto && remoto.notas || [];
  e.instalada = await versionInstalada(a, reg);
  if (!remoto && !e.instalada) e.estado = 'sin';
  else if (!remoto) e.estado = 'sin';
  else e.estado = 'ok';
  pintarEstado(a);
  return e;
}
async function actualizarApp(a){
  const e = EST[a.id]; if (!e) return;
  e.estado = 'actualizando'; pintarEstado(a);
  try {
    let reg = e.reg || await regDe(a);
    if (!reg) reg = await navigator.serviceWorker.register(a.url + 'sw.js', {scope: a.url});
    await reg.update();
    const fin = Date.now() + 25000;
    while (Date.now() < fin && !reg.waiting) {
      if (!reg.installing && !reg.waiting) { await sleep(400); if (!reg.installing) break; }
      await sleep(300);
    }
    if (reg.waiting) { reg.waiting.postMessage('skip'); await sleep(1200); }
  } catch (err) { toast('No se pudo actualizar ' + a.nombre + '. Mira que haya internet.'); }
  await revisar(a, true);
  const e2 = EST[a.id];
  if (e2.instalada && e2.ultima && cmp(e2.instalada, e2.ultima) >= 0) toast(a.nombre + ' ya está en la versión ' + e2.ultima);
}
async function revisarTodas(manual){
  if (manual) toast('Buscando novedades…');
  for (const a of APPS) await revisar(a, true);
  if (manual) {
    const nuevas = APPS.filter(a => { const e = EST[a.id]; return e && e.instalada && e.ultima && cmp(e.instalada, e.ultima) < 0; });
    toast(nuevas.length ? 'Hay novedades en: ' + nuevas.map(a => a.nombre).join(', ') : 'Todo está al día ✓');
  }
  revisarSelf();
}

/* ---------- El propio Estudio (su aviso de actualización) ---------- */
let selfReg = null, actualizandoSelf = false;
function ofrecerSelf(w){
  banner('Hay una versión nueva del Estudio.', [['Más tarde', () => banner('')], ['Actualizar', () => { actualizandoSelf = true; banner('Actualizando…'); w.postMessage('skip'); setTimeout(() => location.reload(), 4000); }, true]]);
}
async function revisarSelf(){
  if (!selfReg) return;
  try { await selfReg.update(); } catch (e) { return; }
  if (selfReg.waiting && navigator.serviceWorker.controller) ofrecerSelf(selfReg.waiting);
}
async function iniciarSW(){
  if (!canSW) return;
  try { selfReg = await navigator.serviceWorker.register('sw.js'); } catch (e) { return; }
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (actualizandoSelf) location.reload(); });
  const mirar = w => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ofrecerSelf(w); });
  if (selfReg.waiting && navigator.serviceWorker.controller) ofrecerSelf(selfReg.waiting);
  mirar(selfReg.installing);
  selfReg.addEventListener('updatefound', () => mirar(selfReg.installing));
}

/* ---------- Instalar ---------- */
let instalar = null;
const esStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalar = e; if (!esStandalone()) $('#bInstall').hidden = false; });
window.addEventListener('appinstalled', () => { instalar = null; $('#bInstall').hidden = true; toast('Estudio Creativo está instalado. Ábrelo desde el escritorio o el inicio.'); });
$('#bInstall').onclick = async () => { if (!instalar) return; instalar.prompt(); try { await instalar.userChoice; } catch (e) {} instalar = null; $('#bInstall').hidden = true; };

/* ---------- Imágenes (fondo y logo) ---------- */
async function imagenes(){
  try {
    const r = await fetch('imagenes.json', {cache: 'no-cache'}); if (!r.ok) return;
    const im = await r.json();
    if (im.fondo) { $('#bg').style.backgroundImage = `url("${im.fondo}")`; $('#bg').classList.add('foto'); }
    if (im.logo) { $('#logo').src = im.logo; }
  } catch (e) {}
}

/* ---------- Destellos del fondo ---------- */
function destellos(){
  const fx = $('#fx'); if (!fx) return;
  const n = innerWidth < 600 ? 16 : 30, colores = ['#fff', '#fff', '#fff', '#fff4b8', '#ffd9ee', '#d9f3ff'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span'), tam = 6 + Math.random() * 16;
    s.className = 'sp' + (Math.random() < .3 ? ' c' : '');
    if (s.className.includes('c')) { s.style.width = s.style.height = (3 + Math.random() * 5) + 'px'; }
    else { s.style.width = s.style.height = tam + 'px'; }
    s.style.background = colores[i % colores.length];
    s.style.left = (Math.random() * 100) + '%'; s.style.top = (8 + Math.random() * 86) + '%';
    s.style.setProperty('--d', (5 + Math.random() * 6).toFixed(1) + 's'); s.style.setProperty('--t', (-Math.random() * 10).toFixed(1) + 's');
    fx.appendChild(s);
  }
}

/* ---------- Arranque ---------- */
async function arrancar(){
  aplicarTema(); montarPanel(); imagenes(); destellos();
  $('#bCheck').onclick = () => revisarTodas(true);
  const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#foot').textContent = `Estudio Creativo ${VER} · Cada programa se guarda en este aparato` + (esStandalone() ? '' : esIOS ? ' · Para instalarlo: Compartir → «Añadir a pantalla de inicio»' : '');
  try { APPS = await (await fetch('apps.json', {cache: 'no-cache'})).json(); }
  catch (e) { $('#cards').innerHTML = '<p class="foot">No se pudo abrir la lista de programas. Mira que haya internet y recarga.</p>'; return; }
  pintarTarjetas();
  iniciarSW();
  await revisarTodas(false);
  setInterval(() => revisarTodas(false), 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisarTodas(false); });
}
arrancar();
})();
