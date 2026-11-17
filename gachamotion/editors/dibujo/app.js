/* GachaMotion · Dibujo por capas (v0.3)
   Mejoras sobre la 0.2: el trazo se dibuja aparte y se pega entero (la opacidad ya no deja «bolitas»),
   el lápiz solo cambia el grosor con la presión (el ratón pinta del tamaño elegido), relleno con tolerancia,
   historial rápido (no recodifica PNG en cada trazo), zoom con rueda/dos dedos, mano para mover la vista,
   duplicar y unir capas y tamaños de lienzo. El formato .gdibujo.json no cambia. */
(() => {
'use strict';
const B = window.GMBridge, $ = id => document.getElementById(id);
const canvas = $('draw-canvas'), ctx = canvas.getContext('2d'), viewport = $('viewport');
const MAX_UNDO = 30;

let project, selectedId, tool = 'brush', color = '#7d77d2', brushSize = 12, opacity = 1, fillTol = 48, zoom = .7;
let stroke = null, strokeBuf = null;      // trazo en curso: {layer, pts, pointerId, eraser, pen, mid, last}
let gesture = null, panning = null;       // dos dedos / herramienta mano
const pointers = new Map();
let undoStack = [], redoStack = [], saveTimer = null, toastTimer = null, idCounter = 0;
let changeRevision = 0, savedRevision = 0, navigationAllowed = false;

const uid = () => `paint_${Date.now().toString(36)}_${++idCounter}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const urlCache = new WeakMap();           // lienzo -> dataURL (un lienzo no cambia una vez terminado)

function status(message, error = false){ $('save-status').textContent = message; $('save-status').style.color = error ? '#ff9faa' : '#5ddac5'; }
function toast(message, error = false){ const t = $('toast'); t.textContent = message; t.style.borderColor = error ? '#ff8a9a' : '#6380a4'; t.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), 3000); }

/* ---------- Capas y proyecto ---------- */
const cloneCanvas = c => { const n = B.makeCanvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; };
const newLayer = (name, art) => ({id: uid(), name, visible: true, opacity: 1, art: art || B.makeCanvas(project.width, project.height)});
function blank(w = 800, h = 800){ project = {version: 1, name: 'Mi dibujo', width: w, height: h, layers: []}; const l = newLayer('Capa 1'); project.layers.push(l); selectedId = l.id; }
const active = () => project.layers.find(l => l.id === selectedId);
const urlOf = c => { let u = urlCache.get(c); if (!u){ u = c.toDataURL('image/png'); urlCache.set(c, u); } return u; };
function toPlain(){
  return {version: 1, name: project.name, width: project.width, height: project.height,
    layers: project.layers.map(l => ({id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, dataUrl: urlOf(l.art)}))};
}
async function loadPlain(data, resetHistory = true){
  if (!data || !Array.isArray(data.layers) || !data.width || !data.height) throw Error('Archivo incompatible');
  const w = clamp(Math.round(+data.width) || 800, 64, 4096), h = clamp(Math.round(+data.height) || 800, 64, 4096);
  const next = {version: 1, name: data.name || 'Dibujo', width: w, height: h, layers: []};
  for (const layer of data.layers){
    const c = B.makeCanvas(w, h);
    if (layer.dataUrl){ const img = await B.imageFromUrl(layer.dataUrl); c.getContext('2d').drawImage(img, 0, 0, w, h); }
    next.layers.push({id: layer.id || uid(), name: layer.name || 'Capa', visible: layer.visible !== false, opacity: layer.opacity ?? 1, art: c});
  }
  if (!next.layers.length) next.layers.push({id: uid(), name: 'Capa 1', visible: true, opacity: 1, art: B.makeCanvas(w, h)});
  project = next; selectedId = next.layers.at(-1).id;
  if (resetHistory){ undoStack = []; redoStack = []; }
  sizeCanvas(); renderUI(); render(); updateHistory();
}

/* ---------- Historial: cada paso guarda las capas tal cual (los lienzos terminados no se vuelven a tocar) ---------- */
function snapshot(){ return {name: project.name, width: project.width, height: project.height, selectedId, layers: project.layers.map(l => ({...l}))}; }
function restore(s){ project = {version: 1, name: s.name, width: s.width, height: s.height, layers: s.layers.map(l => ({...l}))}; selectedId = project.layers.some(l => l.id === s.selectedId) ? s.selectedId : project.layers.at(-1).id; }
function historyPush(){ undoStack.push(snapshot()); if (undoStack.length > MAX_UNDO) undoStack.shift(); redoStack = []; updateHistory(); }
function updateHistory(){ $('btn-undo').disabled = !undoStack.length; $('btn-redo').disabled = !redoStack.length; }
function jump(from, to){
  if (stroke || !from.length) return;
  to.push(snapshot()); restore(from.pop());
  sizeCanvas(); renderUI(); render(); updateHistory(); dirty(false);
}
const undo = () => jump(undoStack, redoStack);
const redo = () => jump(redoStack, undoStack);

/* ---------- Guardado ---------- */
async function saveNow(){
  clearTimeout(saveTimer);
  const revision = changeRevision;
  status('Guardando…');
  try {
    await B.write('paint-project', toPlain());
    savedRevision = Math.max(savedRevision, revision);
    if (changeRevision === revision) status('Autoguardado confirmado ✓');
    return true;
  } catch (e){ status('No guardado · descarga una copia', true); toast(e.message, true); return false; }
}
function dirty(redraw = true){ changeRevision++; clearTimeout(saveTimer); status('Cambios pendientes…'); saveTimer = setTimeout(() => void saveNow(), 650); if (redraw) render(); }
async function verifySave(){
  if (!await saveNow()) return;
  try {
    const saved = await B.read('paint-project');
    if (JSON.stringify(saved) !== JSON.stringify(toPlain())) throw Error('El dibujo guardado no coincide');
    status('Guardado comprobado ✓'); toast('Prueba superada: capas y trazos recuperables');
  } catch (e){ status('Fallo de comprobación', true); toast('Error al verificar: ' + e.message, true); }
}

/* ---------- Dibujar en pantalla ---------- */
function previewArt(l){
  const t = previewArt.tmp && previewArt.tmp.width === project.width && previewArt.tmp.height === project.height ? previewArt.tmp : (previewArt.tmp = B.makeCanvas(project.width, project.height));
  const g = t.getContext('2d'); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, t.width, t.height); g.drawImage(l.art, 0, 0);
  g.globalAlpha = opacity; g.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over'; g.drawImage(strokeBuf, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  return t;
}
function render(){
  if (!project) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const l of project.layers){
    if (!l.visible) continue;
    ctx.globalAlpha = l.opacity;
    ctx.drawImage(stroke && stroke.layer === l ? previewArt(l) : l.art, 0, 0);
  }
  ctx.globalAlpha = 1;
}
function sizeCanvas(){
  canvas.width = project.width; canvas.height = project.height;
  const v = `${project.width}x${project.height}`, sel = $('canvas-size');
  if (![...sel.options].some(o => o.value === v)){ const o = document.createElement('option'); o.value = v; o.textContent = `Personalizado ${project.width} × ${project.height}`; sel.appendChild(o); }
  sel.value = v; applyZoom();
}
function fit(){ zoom = clamp(Math.min((viewport.clientWidth - 35) / project.width, (viewport.clientHeight - 35) / project.height), .1, 2); applyZoom(); }
function applyZoom(){ const a = $('artboard'); a.style.width = Math.round(project.width * zoom) + 'px'; a.style.height = Math.round(project.height * zoom) + 'px'; $('zoom-text').textContent = Math.round(zoom * 100) + '%'; $('size-display').textContent = project.width + ' × ' + project.height; }
// Cambia el zoom dejando quieto el punto (cx, cy) de la pantalla
function setZoom(z, cx, cy){
  z = clamp(z, .1, 4);
  const r = canvas.getBoundingClientRect(), px = (cx - r.left) / r.width, py = (cy - r.top) / r.height;
  zoom = z; applyZoom();
  const n = canvas.getBoundingClientRect();
  viewport.scrollLeft += (n.left + px * n.width) - cx; viewport.scrollTop += (n.top + py * n.height) - cy;
}
function renderUI(){
  $('project-name').value = project.name;
  const host = $('layers'); host.replaceChildren();
  for (let i = project.layers.length - 1; i >= 0; i--){
    const l = project.layers[i], row = document.createElement('div');
    row.className = 'layer' + (l.id === selectedId ? ' selected' : ''); row.dataset.id = l.id;
    const b = document.createElement('button'); b.className = 'tiny'; b.textContent = l.visible ? '◉' : '○'; b.title = l.visible ? 'Ocultar' : 'Mostrar';
    b.onclick = e => { e.stopPropagation(); historyPush(); l.visible = !l.visible; renderUI(); dirty(); };
    const thumb = document.createElement('canvas'); thumb.width = 28; thumb.height = Math.max(1, Math.round(28 * project.height / project.width)); thumb.className = 'thumb';
    thumb.getContext('2d').drawImage(l.art, 0, 0, thumb.width, thumb.height);
    const name = document.createElement('span'); name.className = 'name'; name.textContent = l.name;
    const idx = document.createElement('span'); idx.className = 'order'; idx.textContent = '' + (i + 1);
    row.append(b, thumb, name, idx); row.onclick = () => { selectedId = l.id; renderUI(); };
    host.append(row);
  }
  const l = active();
  if (l){ $('layer-name').value = l.name; $('layer-opacity').value = Math.round(l.opacity * 100); $('layer-opacity-label').textContent = Math.round(l.opacity * 100); }
  updateHistory();
}
function point(e){
  const r = canvas.getBoundingClientRect();
  return {x: clamp((e.clientX - r.left) / r.width * project.width, 0, project.width - 1), y: clamp((e.clientY - r.top) / r.height * project.height, 0, project.height - 1),
          p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1};
}

/* ---------- Pincel y goma ---------- */
const widthFor = (s, p) => Math.max(1, brushSize * (s.pen ? Math.max(.3, p) : 1));
function drawSeg(s, a, b, c){   // curva suave de a a b pasando cerca de c
  const g = strokeBuf.getContext('2d');
  g.lineCap = g.lineJoin = 'round'; g.strokeStyle = s.eraser ? '#000' : color; g.lineWidth = widthFor(s, c.p);
  g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(c.x, c.y, b.x, b.y); g.stroke();
}
function beginStroke(e, p){
  const l = active(); if (!l) return;
  if (!l.visible){ toast('La capa está oculta: muéstrala para dibujar'); return; }
  if (!strokeBuf || strokeBuf.width !== project.width || strokeBuf.height !== project.height) strokeBuf = B.makeCanvas(project.width, project.height);
  const g = strokeBuf.getContext('2d'); g.clearRect(0, 0, strokeBuf.width, strokeBuf.height);
  stroke = {layer: l, pointerId: e.pointerId, eraser: tool === 'eraser', pen: e.pointerType === 'pen', mid: p, last: p};
  g.fillStyle = stroke.eraser ? '#000' : color;
  g.beginPath(); g.arc(p.x, p.y, widthFor(stroke, p.p) / 2, 0, Math.PI * 2); g.fill();
  changeRevision++; status('Trazo sin guardar…'); render();
}
function moveStroke(e){
  const s = stroke; if (!s) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of (evs.length ? evs : [e])){
    const p = point(ev), mid = {x: (s.last.x + p.x) / 2, y: (s.last.y + p.y) / 2, p: (s.last.p + p.p) / 2};
    drawSeg(s, s.mid, mid, s.last); s.mid = mid; s.last = p;
  }
  render();
}
function endStroke(commit = true){
  const s = stroke; if (!s) return;
  if (commit){
    drawSeg(s, s.mid, s.last, s.last);
    historyPush();                                        // el estado anterior queda guardado tal cual
    const art = cloneCanvas(s.layer.art), g = art.getContext('2d');
    g.globalAlpha = opacity; g.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over'; g.drawImage(strokeBuf, 0, 0);
    s.layer.art = art;
  }
  stroke = null; render(); renderUI();
  if (commit){ dirty(false); void saveNow(); }
}

/* ---------- Relleno ---------- */
function flood(layer, x, y){
  const w = project.width, h = project.height, art = cloneCanvas(layer.art), g = art.getContext('2d', {willReadFrequently: true});
  const img = g.getImageData(0, 0, w, h), d = img.data, sx = Math.floor(x), sy = Math.floor(y), p0 = (sy * w + sx) * 4;
  const src = [d[p0], d[p0 + 1], d[p0 + 2], d[p0 + 3]];
  const n = parseInt(color.slice(1), 16), fill = [n >> 16 & 255, n >> 8 & 255, n & 255, Math.round(255 * opacity)];
  const near = k => Math.abs(d[k] - src[0]) <= fillTol && Math.abs(d[k + 1] - src[1]) <= fillTol && Math.abs(d[k + 2] - src[2]) <= fillTol && Math.abs(d[k + 3] - src[3]) <= fillTol;
  const seen = new Uint8Array(w * h), stack = [sx, sy];
  while (stack.length){
    const cy = stack.pop(), cx = stack.pop();
    let x0 = cx; while (x0 >= 0 && !seen[cy * w + x0] && near((cy * w + x0) * 4)) x0--; x0++;
    let up = false, down = false;
    for (let xx = x0; xx < w && !seen[cy * w + xx] && near((cy * w + xx) * 4); xx++){
      seen[cy * w + xx] = 1;
      if (cy > 0){ const t = !seen[(cy - 1) * w + xx] && near(((cy - 1) * w + xx) * 4); if (t && !up){ stack.push(xx, cy - 1); up = true; } else if (!t) up = false; }
      if (cy < h - 1){ const t = !seen[(cy + 1) * w + xx] && near(((cy + 1) * w + xx) * 4); if (t && !down){ stack.push(xx, cy + 1); down = true; } else if (!t) down = false; }
    }
  }
  // Un píxel más alrededor de la zona, para que no quede un «halo» claro junto a las líneas suaves
  const grow = new Uint8Array(seen);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++){
    const i = yy * w + xx; if (seen[i]) continue;
    if ((xx > 0 && seen[i - 1]) || (xx < w - 1 && seen[i + 1]) || (yy > 0 && seen[i - w]) || (yy < h - 1 && seen[i + w])){
      const k = i * 4; if (Math.abs(d[k] - src[0]) + Math.abs(d[k + 1] - src[1]) + Math.abs(d[k + 2] - src[2]) <= fillTol * 4.5 && d[k + 3] >= src[3] * .4 - 1) grow[i] = 1;
    }
  }
  let any = false;
  for (let i = 0; i < w * h; i++) if (grow[i]){ const k = i * 4; if (d[k] !== fill[0] || d[k + 1] !== fill[1] || d[k + 2] !== fill[2] || d[k + 3] !== fill[3]){ d[k] = fill[0]; d[k + 1] = fill[1]; d[k + 2] = fill[2]; d[k + 3] = fill[3]; any = true; } }
  if (!any) return false;
  g.putImageData(img, 0, 0);
  historyPush(); layer.art = art;
  return true;
}
function eyedrop(p){
  render();
  const c = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
  if (c[3] < 8){ toast('Ahí no hay color (transparente)'); return; }
  color = '#' + [0, 1, 2].map(i => c[i].toString(16).padStart(2, '0')).join(''); $('color').value = color; toast('Color seleccionado');
}

/* ---------- Punteros: ratón, lápiz y dedos ---------- */
function onDown(e){
  if (e.button && e.button !== 0) return;
  e.preventDefault();
  // Un puntero «fantasma» (sin aviso de levantado) no debe impedir seguir dibujando
  if (e.pointerType !== 'touch'){ if (stroke) endStroke(true); pointers.clear(); gesture = null; panning = null; }
  pointers.set(e.pointerId, {x: e.clientX, y: e.clientY, type: e.pointerType});
  if (e.pointerType === 'touch' && pointers.size === 2){ if (stroke) endStroke(false); startGesture(); return; }
  if (pointers.size > 1) return;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  if (tool === 'hand'){ panning = {x: e.clientX, y: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop}; return; }
  const l = active(); if (!l) return;
  const p = point(e);
  if (tool === 'picker'){ eyedrop(p); return; }
  if (tool === 'fill'){
    if (!l.visible){ toast('La capa está oculta: muéstrala para rellenar'); return; }
    if (flood(l, p.x, p.y)){ renderUI(); dirty(); void saveNow(); } else toast('Nada que rellenar ahí (ya es de ese color)');
    return;
  }
  beginStroke(e, p);
}
function onMove(e){
  const q = pointers.get(e.pointerId); if (q){ q.x = e.clientX; q.y = e.clientY; }
  if (gesture){ moveGesture(); return; }
  if (panning){ viewport.scrollLeft = panning.sl - (e.clientX - panning.x); viewport.scrollTop = panning.st - (e.clientY - panning.y); return; }
  if (!stroke || e.pointerId !== stroke.pointerId) return;
  if (e.pointerType !== 'touch' && e.buttons === 0){ endStroke(true); pointers.delete(e.pointerId); return; }   // se perdió el aviso de levantado
  e.preventDefault(); moveStroke(e);
}
function onUp(e){
  pointers.delete(e.pointerId);
  if (gesture){ if (pointers.size < 2) gesture = null; return; }
  if (panning){ panning = null; return; }
  if (stroke && e.pointerId === stroke.pointerId) endStroke(true);
  try { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (_) {}
}
function startGesture(){ const [a, b] = [...pointers.values()]; gesture = {d0: Math.hypot(b.x - a.x, b.y - a.y), z0: zoom}; }
function moveGesture(){
  const pts = [...pointers.values()]; if (pts.length < 2) return;
  const [a, b] = pts, d = Math.hypot(b.x - a.x, b.y - a.y);
  setZoom(gesture.z0 * d / Math.max(1, gesture.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
}

/* ---------- Importar, enviar al animador ---------- */
async function importFiles(files){
  if (!files.length) return; historyPush(); let done = 0;
  for (const f of files){
    try {
      const img = await B.imageFromUrl(await B.readFile(f)), l = newLayer(f.name.replace(/\.[^.]+$/, '')), g = l.art.getContext('2d');
      const s = Math.min(1, project.width / img.width, project.height / img.height), w = img.width * s, h = img.height * s;
      g.drawImage(img, (project.width - w) / 2, (project.height - h) / 2, w, h); project.layers.push(l); selectedId = l.id; done++;
    } catch (e){ console.warn(e); }
  }
  renderUI(); dirty(); toast(done + ' imágenes importadas como capas');
}
function cropForAnimation(layer){
  const source = layer.art, g = source.getContext('2d', {willReadFrequently: true});
  const {width: w, height: h} = project, pixels = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ if (pixels[(y * w + x) * 4 + 3] < 8) continue; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 3; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, cut = B.makeCanvas(cw, ch), cg = cut.getContext('2d');
  cg.globalAlpha = layer.opacity; cg.drawImage(source, x0, y0, cw, ch, 0, 0, cw, ch);
  return {name: layer.name, dataUrl: cut.toDataURL('image/png'), x: x0 + cw / 2, y: y0 + ch / 2, pivotX: cw / 2, pivotY: ch / 2};
}
async function sendToAnimation(){
  try {
    if (!await saveNow()) throw Error('No se pudo guardar el dibujo antes de transferir');
    const layers = project.layers.filter(l => l.visible).map(cropForAnimation).filter(Boolean);
    if (!layers.length){ toast('Dibuja alguna pieza antes de transferir.', true); return; }
    await B.send({type: 'layered-art', name: project.name, width: project.width, height: project.height, layers});
    navigationAllowed = true; location.href = '../animation/index.html?transfer=1';
  } catch (e){ toast('Error al transferir: ' + e.message, true); }
}
function drawContained(l, img){
  const s = Math.min(project.width / img.width, project.height / img.height), w = img.width * s, h = img.height * s;
  l.art.getContext('2d').drawImage(img, (project.width - w) / 2, (project.height - h) / 2, w, h);
}
async function acceptTransfer(){
  if (!location.search.includes('transfer')) return;
  const item = await B.receive(); if (!item) return;
  historyPush();
  if (item.type === 'flat-image'){ const l = newLayer(item.name || 'Fotograma recibido'); drawContained(l, await B.imageFromUrl(item.dataUrl)); project.layers.push(l); selectedId = l.id; renderUI(); dirty(); toast('Fotograma importado desde animación'); }
  else if (item.type === 'layered-art'){ for (const old of item.layers || []){ const l = newLayer(old.name); drawContained(l, await B.imageFromUrl(old.dataUrl)); project.layers.push(l); selectedId = l.id; } renderUI(); dirty(); }
}

/* ---------- Operaciones de capa y de lienzo ---------- */
function resizeProject(w, h){
  if (w === project.width && h === project.height) return;
  historyPush();
  const dx = Math.round((w - project.width) / 2), dy = Math.round((h - project.height) / 2);
  for (const l of project.layers){ const c = B.makeCanvas(w, h); c.getContext('2d').drawImage(l.art, dx, dy); l.art = c; }
  project.width = w; project.height = h; sizeCanvas(); fit(); renderUI(); dirty();
}
function mergeDown(){
  const l = active(), i = project.layers.indexOf(l);
  if (i <= 0){ toast('No hay capa debajo para unir'); return; }
  const below = project.layers[i - 1];
  historyPush();
  const art = cloneCanvas(below.art), g = art.getContext('2d');
  g.globalAlpha = l.visible ? l.opacity : 0; g.drawImage(l.art, 0, 0);
  const merged = {...below, art}; project.layers.splice(i - 1, 2, merged); selectedId = merged.id; renderUI(); dirty();
}
function setTool(t){
  tool = t; document.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x.dataset.tool === t));
  canvas.style.cursor = t === 'hand' ? 'grab' : t === 'picker' ? 'copy' : 'crosshair';
}
const KEYS = {b: 'brush', e: 'eraser', g: 'fill', i: 'picker', h: 'hand'};
function setupUI(){
  document.querySelector('.topbar>a').addEventListener('click', async e => { if (window.parent !== window){ e.preventDefault(); if (!await saveNow()) return; navigationAllowed = true; window.parent.postMessage({gmstudio: 1, action: 'home'}, '*'); } });
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('color').oninput = e => color = e.target.value;
  $('size').oninput = e => { $('size-label').textContent = e.target.value; brushSize = Number(e.target.value); };
  $('opacity').oninput = e => { $('opacity-label').textContent = e.target.value; opacity = Number(e.target.value) / 100; };
  $('fill-tol').oninput = e => { $('fill-tol-label').textContent = e.target.value; fillTol = Number(e.target.value); };
  $('canvas-size').onchange = e => { const [w, h] = e.target.value.split('x').map(Number); resizeProject(w, h); };
  $('project-name').onchange = e => { historyPush(); project.name = e.target.value.trim() || 'Mi dibujo'; dirty(); };
  $('btn-new').onclick = () => { if (!confirm('¿Crear un dibujo vacío? Guarda el dibujo actual antes de continuar.')) return; const [w, h] = $('canvas-size').value.split('x').map(Number); blank(w, h); sizeCanvas(); fit(); renderUI(); undoStack = []; redoStack = []; updateHistory(); dirty(); };
  $('btn-import').onclick = () => $('file-image').click(); $('file-image').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };
  $('btn-save').onclick = () => { try { B.download(new Blob([JSON.stringify(toPlain(), null, 2)], {type: 'application/json'}), B.cleanName(project.name) + '.gdibujo.json'); toast('Copia enviada a Descargas; comprueba el archivo .gdibujo.json'); void saveNow(); } catch (e){ toast('Error al generar copia: ' + e.message, true); } };
  $('btn-verify').onclick = verifySave;
  $('btn-load').onclick = () => $('file-project').click();
  $('file-project').onchange = async e => { if (!e.target.files[0]) return; try { await loadPlain(JSON.parse(await B.readFile(e.target.files[0], 'text'))); fit(); dirty(); toast('Dibujo y capas recuperados'); } catch (err){ toast('Error al abrir: ' + err.message, true); } e.target.value = ''; };
  $('btn-undo').onclick = undo; $('btn-redo').onclick = redo;
  $('btn-clear').onclick = () => { const l = active(); if (!l || !confirm('¿Borrar todos los trazos de esta capa?')) return; historyPush(); l.art = B.makeCanvas(project.width, project.height); renderUI(); dirty(); };
  $('btn-add').onclick = () => { historyPush(); const l = newLayer('Capa ' + (project.layers.length + 1)); project.layers.splice(project.layers.indexOf(active()) + 1, 0, l); selectedId = l.id; renderUI(); dirty(); };
  $('btn-dup').onclick = () => { const l = active(); if (!l) return; historyPush(); const c = {...l, id: uid(), name: l.name + ' (copia)', art: cloneCanvas(l.art)}; project.layers.splice(project.layers.indexOf(l) + 1, 0, c); selectedId = c.id; renderUI(); dirty(); };
  $('btn-merge').onclick = mergeDown;
  $('btn-up').onclick = () => { const l = active(), i = project.layers.indexOf(l); if (i < 0 || i === project.layers.length - 1) return; historyPush(); project.layers.splice(i, 1); project.layers.splice(i + 1, 0, l); renderUI(); dirty(); };
  $('btn-down').onclick = () => { const l = active(), i = project.layers.indexOf(l); if (i <= 0) return; historyPush(); project.layers.splice(i, 1); project.layers.splice(i - 1, 0, l); renderUI(); dirty(); };
  $('btn-delete').onclick = () => { if (project.layers.length <= 1){ toast('Debe quedar al menos una capa'); return; } const l = active(); if (!l) return; historyPush(); const i = project.layers.indexOf(l); project.layers = project.layers.filter(x => x !== l); selectedId = project.layers[Math.max(0, i - 1)].id; renderUI(); dirty(); };
  $('layer-name').onchange = e => { const l = active(); if (!l) return; historyPush(); l.name = e.target.value.trim() || 'Capa'; renderUI(); dirty(); };
  const lo = $('layer-opacity'); let loPushed = false;
  lo.oninput = e => { const l = active(); if (!l) return; $('layer-opacity-label').textContent = e.target.value; if (!loPushed){ historyPush(); loPushed = true; } l.opacity = clamp(Number(e.target.value) / 100, 0, 1); render(); dirty(false); };
  lo.onchange = () => { loPushed = false; };
  $('zoom-in').onclick = () => { const r = viewport.getBoundingClientRect(); setZoom(zoom * 1.2, r.left + r.width / 2, r.top + r.height / 2); };
  $('zoom-out').onclick = () => { const r = viewport.getBoundingClientRect(); setZoom(zoom / 1.2, r.left + r.width / 2, r.top + r.height / 2); };
  $('zoom-fit').onclick = fit;
  $('export-png').onclick = () => { const out = B.makeCanvas(project.width, project.height), g = out.getContext('2d'); for (const l of project.layers){ if (!l.visible) continue; g.globalAlpha = l.opacity; g.drawImage(l.art, 0, 0); } out.toBlob(blob => { if (blob){ B.download(blob, B.cleanName(project.name) + '.png'); toast('PNG transparente descargado'); } }, 'image/png'); };
  $('send-animation').onclick = sendToAnimation;
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', e => { if (stroke && e.pointerId === stroke.pointerId) onUp(e); });
  viewport.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * .002), e.clientX, e.clientY); }, {passive: false});
  viewport.addEventListener('dragover', e => e.preventDefault()); viewport.addEventListener('drop', e => { e.preventDefault(); importFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))); });
  document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z'){ e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y'){ e.preventDefault(); redo(); }
    else if (mod && k === 's'){ e.preventDefault(); $('btn-save').click(); }
    else if (!mod && KEYS[k]) setTool(KEYS[k]);
    else if (!mod && (k === '[' || k === ']')){ const v = clamp(brushSize + (k === ']' ? 1 : -1) * Math.max(1, Math.round(brushSize * .15)), 1, 90); $('size').value = v; $('size').oninput({target: $('size')}); }
  });
  window.addEventListener('resize', () => { if (project) fit(); });
  window.addEventListener('blur', () => { if (stroke) endStroke(true); pointers.clear(); gesture = null; panning = null; });
  window.addEventListener('beforeunload', e => { if (!navigationAllowed && changeRevision > savedRevision){ e.preventDefault(); e.returnValue = ''; } });
}
async function start(){
  setupUI();
  try {
    const prior = await B.read('paint-project');
    if (prior?.layers){ await loadPlain(prior); status('Dibujo recuperado ✓'); }
    else { blank(); sizeCanvas(); renderUI(); dirty(); }
    fit(); await acceptTransfer();
  } catch (e){ console.warn(e); blank(); sizeCanvas(); renderUI(); fit(); status('No se pudo recuperar · carga copia JSON', true); toast('No se pudo recuperar el dibujo anterior. Usa Cargar.', true); }
}
window.GachaPaintApp = {getProject: () => toPlain(), loadProject: loadPlain, select: id => { selectedId = id; renderUI(); }, save: () => $('btn-save').click(), historySize: () => undoStack.length};
start();
})();
