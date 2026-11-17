/* GachaMotion Studio v0.2 — persistence, backups and editor transfers.
   Fully local. Backward-compatible with the unwrapped v0.1 documents. */
(function () {
  'use strict';
  const DB_NAME = 'GachaMotionStudio_v1', STORE = 'documents';
  const FALLBACK_PREFIX = 'gmstudio:';
  const queues = new Map();
  let sequence = 0, requestSeq = 0;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(Error('IndexedDB no disponible'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || Error('No se pudo abrir IndexedDB'));
      req.onblocked = () => reject(Error('Base de datos bloqueada por otra pestaña'));
    });
  }

  // Important: IDB request.onsuccess is NOT a successful save. Only the
  // transaction's oncomplete event confirms a committed write.
  async function operate(mode, key, value) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        let tx, result;
        try {
          tx = db.transaction(STORE, mode);
          const obj = tx.objectStore(STORE);
          const req = mode === 'readonly' ? obj.get(key) :
            value === undefined ? obj.delete(key) : obj.put(value, key);
          req.onsuccess = () => { result = req.result; };
          req.onerror = () => reject(req.error || Error('Error al acceder a la base de datos'));
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error || Error('Error al finalizar el guardado'));
          tx.onabort = () => reject(tx.error || Error('Guardado cancelado por el navegador'));
        } catch (e) { reject(e); }
      });
    } finally { db.close(); }
  }

  // Serialized per key: late completion of an older write cannot overwrite a
  // newer project. A failed write does not block subsequent attempts.
  function enqueue(key, task) {
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(key, next);
    void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  }
  const copy = data => typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data));
  const wrapped = data => ({__gmstudioRecord:2, revision:Date.now()*1000 + (++sequence%1000), data:copy(data)});
  function unpack(value) {
    if (value === undefined || value === null) return null;
    if (value.__gmstudioRecord === 2 && Object.hasOwn(value,'data'))
      return {revision:Number(value.revision)||0, data:value.data};
    return {revision:0, data:value}; // v0.1 compatibility
  }
  const storageKey = key => FALLBACK_PREFIX + key;

  async function localWrite(key, record) {
    try {
      await operate('readwrite', key, record);
      return 'IndexedDB';
    } catch (dbError) {
      try {
        const json = JSON.stringify(record);
        localStorage.setItem(storageKey(key), json);
        if (localStorage.getItem(storageKey(key)) !== json) throw Error('La copia local no coincide');
        return 'localStorage';
      } catch (storageError) {
        throw Error('No se pudo guardar en el navegador (almacenamiento bloqueado o lleno). Descarga una copia del proyecto.');
      }
    }
  }
  async function localRead(key) {
    let idb = null, local = null, errorDb = null, errorLocal = null;
    try { idb = unpack(await operate('readonly',key)); } catch(e) { errorDb = e; }
    try { const raw = localStorage.getItem(storageKey(key)); if(raw !== null) local = unpack(JSON.parse(raw)); }
    catch(e) { errorLocal = e; }
    // A fallback save must beat any stale, previously saved IndexedDB value.
    const winner = idb && local ? (local.revision > idb.revision ? local : idb) : (idb || local);
    if (winner) return winner.data;
    if (errorDb && errorLocal) throw Error('No se pudo leer el almacenamiento. Abre un proyecto desde tu copia JSON.');
    return null;
  }
  async function localRemove(key) {
    let dbOk = false, lsOk = false;
    try { await operate('readwrite',key,undefined); dbOk = true; } catch (_) {}
    try { localStorage.removeItem(storageKey(key)); lsOk = true; } catch (_) {}
    if (!dbOk && !lsOk) throw Error('No se pudo eliminar el dato transferido');
  }

  // In the selector iframe, communicate with its stable storage origin.
  // Never pretend a timed-out host save succeeded in an iframe-specific origin.
  function hostCall(action, payload={}) {
    if (window.parent === window) return Promise.resolve({connected:false});
    return new Promise(resolve => {
      const id = 'request_' + (++requestSeq);
      const finish = result => {clearTimeout(timer); window.removeEventListener('message',handler); resolve(result);};
      const handler = e => {const v=e.data;if(e.source===window.parent && v?.gmstudio===1 && v?.replyTo===id)finish(v);};
      const timer = setTimeout(() => finish({connected:true,ok:false,error:'El selector no confirmó el guardado. Descarga una copia.'}),25000);
      window.addEventListener('message',handler);
      window.parent.postMessage({gmstudio:1,id,action,...payload},'*');
    });
  }
  async function write(key, data) {
    const record = copy(data); // freeze a snapshot when called
    return enqueue(key,async () => {
      const response = await hostCall('write',{key,data:record});
      if(response.connected) {
        if(response.ok) return response.backend || 'selector';
        throw Error(response.error || 'El guardado no se confirmó');
      }
      return await localWrite(key,wrapped(record));
    });
  }
  async function read(key) {
    await (queues.get(key) || Promise.resolve()).catch(() => {});
    const response = await hostCall('read',{key});
    if(response.connected) {
      if(!response.ok) throw Error(response.error || 'No se pudo leer el proyecto');
      return response.value ?? null;
    }
    return localRead(key);
  }
  async function remove(key) {
    return enqueue(key,async () => {
      const response = await hostCall('remove',{key});
      if(response.connected) {if(!response.ok) throw Error(response.error || 'Error al eliminar');return;}
      return localRemove(key);
    });
  }
  async function send(payload) {await write('editor-transfer',{...payload,createdAt:Date.now()});}
  async function receive() {
    const value = await read('editor-transfer');
    // Do not erase a transfer unless its receipt was actually read.
    if(value) await remove('editor-transfer');
    return value;
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function cleanName(name) {
    return (String(name||'proyecto').trim().replace(/[^\p{L}\p{N}_ -]/gu,'_').replace(/\s+/g,'_').slice(0,65)||'proyecto');
  }
  function readFile(file, as='dataURL') {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);
      if(as==='text')reader.readAsText(file);else reader.readAsDataURL(file);
    });
  }
  function imageFromUrl(src) {
    return new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('No se pudo abrir la imagen'));img.src=src;
    });
  }
  function makeCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
  function compactImage(img,limit=1400){
    const ratio=Math.min(1,limit/Math.max(img.width,img.height));
    const c=makeCanvas(Math.max(1,Math.round(img.width*ratio)),Math.max(1,Math.round(img.height*ratio)));
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return {dataUrl:c.toDataURL('image/png'),width:c.width,height:c.height};
  }
  window.GMBridge={read,write,remove,send,receive,download,cleanName,readFile,imageFromUrl,makeCanvas,compactImage};
})();
