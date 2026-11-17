/* GachaMotion · actualizaciones. Registra la copia sin internet y avisa cuando hay una versión nueva. */
(() => {
'use strict';
if (!('serviceWorker' in navigator)) return;
let waiting = null, updating = false, later = null, reg = null;
const st = document.createElement('style');
st.textContent = '.gm-upd{position:fixed;z-index:99;left:50%;bottom:18px;transform:translateX(-50%);width:min(560px,calc(100vw - 28px));background:#1b2440;border:1px solid #7c93ff;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:#e9effc;box-shadow:0 12px 38px #000a;font-size:13px}.gm-upd[hidden]{display:none}.gm-upd span{flex:1 1 220px}.gm-upd button{margin:0}';
document.head.appendChild(st);
const box = document.createElement('div'); box.className = 'gm-upd'; box.hidden = true; box.setAttribute('role', 'status');
box.innerHTML = '<span id="gm-upd-txt">Hay una versión nueva de GachaMotion.</span><button type="button" id="gm-upd-later">Más tarde</button><button type="button" class="primary" id="gm-upd-go">Actualizar</button>';
document.body.appendChild(box);
const editing = () => document.body.classList.contains('editing');
function mostrar(){ if (!waiting || waiting === later || editing()) { box.hidden = true; return; } box.hidden = false; }
box.querySelector('#gm-upd-later').onclick = () => { later = waiting; box.hidden = true; };
box.querySelector('#gm-upd-go').onclick = () => { updating = true; box.querySelector('#gm-upd-txt').textContent = 'Actualizando…'; waiting.postMessage('skip'); setTimeout(() => location.reload(), 4000); };
function vigilar(w){ if (!w) return; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller){ waiting = w; mostrar(); } }); }
navigator.serviceWorker.register('sw.js').then(r => {
  reg = r;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  if (r.waiting && navigator.serviceWorker.controller){ waiting = r.waiting; mostrar(); }
  vigilar(r.installing); r.addEventListener('updatefound', () => vigilar(r.installing));
  const buscar = () => { r.update().catch(() => {}); };
  setInterval(buscar, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') buscar(); });
  buscar();
}).catch(() => {});
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
window.GMUpdate = {recheck: mostrar};
})();
