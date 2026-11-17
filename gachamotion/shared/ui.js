/* GachaMotion · avisos propios. Sustituyen a confirm() del navegador, que a veces se bloquea
   (y entonces «eliminar» parecía no hacer nada), y dan un «Deshacer» a mano. */
(() => {
'use strict';
const st = document.createElement('style');
st.textContent = `
.gmui-back{position:fixed;inset:0;z-index:200;background:#02050bb0;display:flex;align-items:center;justify-content:center;padding:16px}
.gmui-box{background:#1b2440;border:1px solid #7c93ff;border-radius:16px;padding:20px 22px;max-width:420px;width:100%;color:#e9effc;box-shadow:0 18px 60px #000c}
.gmui-box p{margin:0 0 16px;font-size:14px;line-height:1.5}
.gmui-box .row{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.gmui-box button{padding:10px 16px;font-size:13px}
.gmui-snack{position:fixed;z-index:190;left:50%;bottom:26px;transform:translateX(-50%);background:#293b58;border:1px solid #6380a4;color:#f2f6ff;border-radius:12px;padding:10px 12px 10px 16px;display:flex;gap:12px;align-items:center;box-shadow:0 12px 38px #000a;font-size:13px;max-width:min(92vw,520px)}
.gmui-snack button{padding:6px 12px;font-size:12px;margin:0}`;
document.head.appendChild(st);

// confirmar(msg, textoOk) → Promise<boolean>
function confirmar(msg, ok = 'Aceptar', cancelar = 'Cancelar'){
  return new Promise(res => {
    const back = document.createElement('div'); back.className = 'gmui-back'; back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true');
    const box = document.createElement('div'); box.className = 'gmui-box';
    const p = document.createElement('p'); p.textContent = msg;
    const row = document.createElement('div'); row.className = 'row';
    const bc = document.createElement('button'); bc.type = 'button'; bc.textContent = cancelar;
    const bo = document.createElement('button'); bo.type = 'button'; bo.className = 'primary'; bo.textContent = ok;
    row.append(bc, bo); box.append(p, row); back.append(box); document.body.append(back);
    const fin = v => { document.removeEventListener('keydown', key, true); back.remove(); res(v); };
    const key = e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fin(false); } else if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); fin(true); } };
    document.addEventListener('keydown', key, true);
    bc.onclick = () => fin(false); bo.onclick = () => fin(true);
    back.addEventListener('pointerdown', e => { if (e.target === back) fin(false); });
    bo.focus();
  });
}

// aviso con botón (por ejemplo «Deshacer»), se va solo a los 8 s
let snack = null, snackT = 0;
function aviso(msg, etiqueta, fn){
  if (snack) snack.remove(); clearTimeout(snackT);
  snack = document.createElement('div'); snack.className = 'gmui-snack'; snack.setAttribute('role', 'status');
  const s = document.createElement('span'); s.textContent = msg; snack.append(s);
  if (etiqueta){ const b = document.createElement('button'); b.type = 'button'; b.textContent = etiqueta; b.onclick = () => { snack.remove(); snack = null; fn && fn(); }; snack.append(b); }
  document.body.append(snack);
  snackT = setTimeout(() => { if (snack){ snack.remove(); snack = null; } }, 8000);
}
window.GMUI = {confirmar, aviso};
})();
