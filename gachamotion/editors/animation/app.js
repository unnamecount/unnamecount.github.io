(() => {
'use strict';
const $ = id => document.getElementById(id);
const B = window.GMBridge;
const canvas = $('stage-canvas'), ctx = canvas.getContext('2d');
const overlay = $('controls-canvas'), overlayCtx = overlay.getContext('2d');
const stage = $('stage'), viewport = $('viewport');
const cache = new Map();
const framesPerPx = 12;
let project, selectedId = null, currentFrame = 0, tool = 'move';
let playing = false, frameTimer = 0, lastTick = 0, dragging = null;
let zoom = 0.65, showBones = true, autoKey = true;
let undoStack = [], redoStack = [], toastTimer = null, saveTimer = null, requestRenderId = 0;
let exportBusy = false;
let changeRevision=0, savedRevision=0, navigationAllowed=false;
let idCounter = 0;
const clone = value => JSON.parse(JSON.stringify(value));
const num = (v, def=0) => Number.isFinite(Number(v)) ? Number(v) : def;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round = n => Math.round(n * 10)/10;
const uid = () => `gm_${Date.now().toString(36)}_${++idCounter}`;
const blankMesh = () => Array.from({length:9}, () => ({dx:0,dy:0}));
const blankPose = (x=0,y=0,pivotX=0,pivotY=0) => ({x,y,angle:0,scaleX:1,scaleY:1,opacity:1,pivotX,pivotY,mesh:blankMesh()});
const identity = [1,0,0,1,0,0];
function mul(A, C) { return [A[0]*C[0]+A[2]*C[1],A[1]*C[0]+A[3]*C[1],A[0]*C[2]+A[2]*C[3],A[1]*C[2]+A[3]*C[3],A[0]*C[4]+A[2]*C[5]+A[4],A[1]*C[4]+A[3]*C[5]+A[5]]; }
function inverse(m) { const det=m[0]*m[3]-m[1]*m[2]; if(Math.abs(det)<1e-9)return identity; return [m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,(m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det]; }
function apply(m,x,y){return {x:m[0]*x+m[2]*y+m[4], y:m[1]*x+m[3]*y+m[5]};}
function localMatrix(p) {const a=p.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*p.scaleX,s*p.scaleX,-s*p.scaleY,c*p.scaleY,p.x,p.y];}
function newProject(){return {version:1,name:'Mi primer personaje',width:800,height:800,format:'square',fps:24,duration:120,background:'#b5bdce',showBackground:false,blink:{enabled:true,interval:3,duration:0.2},layers:[]};}
const findLayer = id => project.layers.find(l=>l.id===id);
const activeLayer = () => findLayer(selectedId);
function createLayer(name,kind,parent,asset,x,y,pivotX,pivotY){return {id:uid(),name,kind,parent:parent||null,visible:true,width:asset.width,height:asset.height,dataUrl:asset.dataUrl,base:blankPose(x,y,pivotX,pivotY),keys:{}};}
function toast(message, error=false){const box=$('toast');box.textContent=message;box.style.borderColor=error?'#e98189':'#6380a4';box.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove('visible'),3000);}
function status(msg, bad=false){$('save-status').textContent=msg;$('save-status').style.color=bad?'#ffa2ad':'#5ddac5';}
function cloneProject(p){ return {...p, blink:{...(p.blink||{})}, layers:(p.layers||[]).map(l=>l&&l.base?{...l,base:clone(l.base),keys:clone(l.keys||{})}:l)}; } // las imágenes (texto) se comparten: no cambian
function capture(){ return cloneProject(project); }
function pushUndo(){ if(!project) return;undoStack.push(capture());if(undoStack.length>25)undoStack.shift();redoStack.length=0;updateHistoryButtons();}
function updateHistoryButtons(){ $('btn-undo').disabled=!undoStack.length;$('btn-redo').disabled=!redoStack.length; }
async function undo(){if(!undoStack.length)return;redoStack.push(capture());const p=undoStack.pop();await loadProject(p,false);updateHistoryButtons();saveSoon();}
async function redo(){if(!redoStack.length)return;undoStack.push(capture());const p=redoStack.pop();await loadProject(p,false);updateHistoryButtons();saveSoon();}
function saveSoon(){
 changeRevision++;
 clearTimeout(saveTimer);
 status('Cambios pendientes…');
 saveTimer=setTimeout(()=>void saveNow(),550);
}
async function saveNow(){
 clearTimeout(saveTimer);
 const revision=changeRevision, snapshot=capture();
 status('Guardando…');
 try {
  const backend=await B.write('animation-project',snapshot);
  savedRevision=Math.max(savedRevision,revision);
  if(changeRevision===revision)status('Autoguardado confirmado ✓');
  return true;
 }catch(e){
  status('No guardado · descarga una copia',true);
  toast(e.message,true);
  return false;
 }
}
async function verifySave(){
 if(!await saveNow())return;
 try {
  const saved=await B.read('animation-project');
  if(JSON.stringify(saved)!==JSON.stringify(capture()))throw Error('La copia guardada no coincide con los cambios actuales');
  status('Guardado comprobado ✓');toast('Prueba superada: el proyecto se puede volver a leer');
 }catch(e){status('Fallo de comprobación',true);toast('Error al verificar: '+e.message,true);}
}
function dirty(){saveSoon();requestRender();}
function getBase(l){return l.base;}
function lerp(a,b,t){return a+(b-a)*t;}
function blendPose(a,b,t){const p={};for(const key of ['x','y','angle','scaleX','scaleY','opacity','pivotX','pivotY'])p[key]=lerp(a[key],b[key],t);p.mesh=a.mesh.map((v,i)=>({dx:lerp(v.dx,b.mesh[i].dx,t),dy:lerp(v.dy,b.mesh[i].dy,t)}));return p;}
function poseAt(layer, frame=currentFrame){
 const entries=[{frame:0,pose:layer.base},...Object.entries(layer.keys||{}).map(([f,p])=>({frame:Number(f),pose:p}))];
 const keyed=new Map();for(const entry of entries)keyed.set(entry.frame,entry.pose);
 const all=[...keyed].map(([f,p])=>({frame:f,pose:p})).sort((a,b)=>a.frame-b.frame);
 if(frame<=all[0].frame)return clone(all[0].pose);
 if(frame>=all.at(-1).frame)return clone(all.at(-1).pose);
 for(let i=1;i<all.length;i++)if(frame<=all[i].frame){const a=all[i-1],b=all[i];const t=(frame-a.frame)/(b.frame-a.frame);return blendPose(a.pose,b.pose,t);}
 return clone(layer.base);
}
function getPoseForEdit(layer){return poseAt(layer);}
function setPose(layer,newPose,trigger=false){
 if(autoKey) layer.keys[currentFrame]=clone(newPose);
 else layer.base=clone(newPose);
 if(trigger){dirty();syncProperties();renderTimeline();}
}
function updatePose(field,value){const l=activeLayer();if(!l)return;pushUndo();const pose=getPoseForEdit(l);pose[field]=value;setPose(l,pose,true);}
function setKey(layer,frame,pose){layer.keys[clamp(Math.round(frame),0,project.duration-1)]=clone(pose);}
function matrixFor(layer,frame=currentFrame,memo=new Map()){
 if(memo.has(layer.id))return memo.get(layer.id);
 const pose=poseAt(layer,frame), own=localMatrix(pose);
 let world=own;
 if(layer.parent){const parent=findLayer(layer.parent);if(parent && parent.id!==layer.id)world=mul(matrixFor(parent,frame,memo),own);}
 memo.set(layer.id,world);return world;
}
function blinkScale(frame){
 if(!project.blink?.enabled) return 1;
 const interval=clamp(num(project.blink.interval,3),.5,20), duration=clamp(num(project.blink.duration,.2),.08,1);
 const t=(frame/project.fps+0.32)%interval;
 return t>=duration?1:1-.94*Math.sin(Math.PI*t/duration);
}
function imageFor(layer){return cache.get(layer.id)?.image||null;}
async function loadImage(layer){try {const image=await B.imageFromUrl(layer.dataUrl);cache.set(layer.id,{image,alpha:null,src:layer.dataUrl});return image;}catch(e){console.warn('Capa dañada',layer.name,e);return null;}}
function ensureImages(){return Promise.all(project.layers.map(l=>cache.get(l.id)?.src===l.dataUrl?cache.get(l.id).image:loadImage(l)));}
function triangleMap(g,a,b,c,srcA,srcB,srcC,img){
 const [x0,y0]=srcA,[x1,y1]=srcB,[x2,y2]=srcC;
 const [u0,v0]=a,[u1,v1]=b,[u2,v2]=c;
 const den=(x0*(y1-y2)+x1*(y2-y0)+x2*(y0-y1));if(Math.abs(den)<1e-8)return;
 const A=(u0*(y1-y2)+u1*(y2-y0)+u2*(y0-y1))/den;
 const C=(u0*(x2-x1)+u1*(x0-x2)+u2*(x1-x0))/den;
 const E=(u0*(x1*y2-x2*y1)+u1*(x2*y0-x0*y2)+u2*(x0*y1-x1*y0))/den;
 const D=(v0*(y1-y2)+v1*(y2-y0)+v2*(y0-y1))/den;
 const F=(v0*(x2-x1)+v1*(x0-x2)+v2*(x1-x0))/den;
 const G=(v0*(x1*y2-x2*y1)+v1*(x2*y0-x0*y2)+v2*(x0*y1-x1*y0))/den;
 const cx=(u0+u1+u2)/3,cy=(v0+v1+v2)/3,ex=(u,v)=>{const dx=u-cx,dy=v-cy,l=Math.hypot(dx,dy)||1;return [u+dx/l*.6,v+dy/l*.6];};const [a0,a1]=ex(u0,v0),[b0,b1]=ex(u1,v1),[c0,c1]=ex(u2,v2);
 g.save();g.beginPath();g.moveTo(a0,a1);g.lineTo(b0,b1);g.lineTo(c0,c1);g.closePath();g.clip();g.transform(A,D,C,F,E,G);g.drawImage(img,0,0);g.restore();
}
function drawWarp(g,img,layer,pose){
 const w=layer.width,h=layer.height;
 const vertex=(i)=>{const col=i%3,row=Math.floor(i/3);return [col*w/2-pose.pivotX+pose.mesh[i].dx,row*h/2-pose.pivotY+pose.mesh[i].dy];};
 const source=i=>[(i%3)*w/2,Math.floor(i/3)*h/2];
 for(let r=0;r<2;r++)for(let c=0;c<2;c++){
  const t=r*3+c,a=t,b=t+1,d=t+3,e=t+4;
  triangleMap(g,vertex(a),vertex(b),vertex(e),source(a),source(b),source(e),img);
  triangleMap(g,vertex(a),vertex(e),vertex(d),source(a),source(e),source(d),img);
 }
}
function renderScene(g,frame=currentFrame,w=project.width,h=project.height,withBackground=project.showBackground){
 g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,w,h);
 if(withBackground){g.fillStyle=project.background;g.fillRect(0,0,w,h);}
 const mCache=new Map();
 for(const layer of project.layers){if(!layer.visible)continue;const image=imageFor(layer);if(!image)continue;
  const p=poseAt(layer,frame),world=matrixFor(layer,frame,mCache);
  g.save();g.setTransform(...world);g.globalAlpha=clamp(p.opacity,0,1);
  if(layer.kind==='eye')g.scale(1,blinkScale(frame));
  if(p.mesh?.some(v=>Math.abs(v.dx)+Math.abs(v.dy)>.05))drawWarp(g,image,layer,p);
  else g.drawImage(image,-p.pivotX,-p.pivotY,layer.width,layer.height);
  g.restore();
 }
 g.setTransform(1,0,0,1,0,0);
}
function requestRender(){cancelAnimationFrame(requestRenderId);requestRenderId=requestAnimationFrame(render);}
function drawHandle(g,p,fill,rad=7){g.beginPath();g.arc(p.x,p.y,rad,0,Math.PI*2);g.fillStyle=fill;g.fill();g.lineWidth=2;g.strokeStyle='#141927';g.stroke();}
function layerCorners(layer,frame=currentFrame){const p=poseAt(layer,frame),m=matrixFor(layer,frame);return [apply(m,-p.pivotX,-p.pivotY),apply(m,layer.width-p.pivotX,-p.pivotY),apply(m,layer.width-p.pivotX,layer.height-p.pivotY),apply(m,-p.pivotX,layer.height-p.pivotY)];}
function meshVertices(l,p,m){const out=[];for(let i=0;i<9;i++)out.push(apply(m,(i%3)*l.width/2-p.pivotX+p.mesh[i].dx,Math.floor(i/3)*l.height/2-p.pivotY+p.mesh[i].dy));return out;}
function renderControls(){
 const g=overlayCtx;g.clearRect(0,0,overlay.width,overlay.height);
 if(showBones){for(const layer of project.layers){if(!layer.parent||!layer.visible)continue;const parent=findLayer(layer.parent);if(!parent)continue;const p=apply(matrixFor(layer),0,0),q=apply(matrixFor(parent),0,0);g.beginPath();g.moveTo(q.x,q.y);g.lineTo(p.x,p.y);g.strokeStyle='#75ebd0aa';g.lineWidth=2;g.setLineDash([6,4]);g.stroke();g.setLineDash([]);drawHandle(g,p,'#55ccba',4);}}
 const l=activeLayer();if(!l||!l.visible)return;
 const p=poseAt(l),m=matrixFor(l),corners=layerCorners(l);
 g.beginPath();g.moveTo(corners[0].x,corners[0].y);corners.slice(1).forEach(q=>g.lineTo(q.x,q.y));g.closePath();g.strokeStyle='#91a8ff';g.lineWidth=2;g.setLineDash([7,4]);g.stroke();g.setLineDash([]);
 const pivot=apply(m,0,0);drawHandle(g,pivot,'#ffd177',7);
 if(tool==='rotate'){const mid={x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2};const dx=mid.x-pivot.x,dy=mid.y-pivot.y,dist=Math.max(1,Math.hypot(dx,dy));const handle={x:mid.x+dx/dist*27,y:mid.y+dy/dist*27};g.beginPath();g.moveTo(mid.x,mid.y);g.lineTo(handle.x,handle.y);g.strokeStyle='#d3acff';g.stroke();drawHandle(g,handle,'#d3acff',8);}
 if(tool==='warp'){
 const vertices=meshVertices(l,p,m);
 g.strokeStyle='#67e4d9';g.lineWidth=1.5;g.setLineDash([3,3]);
 for(let r=0;r<3;r++){g.beginPath();for(let c=0;c<3;c++){const a=vertices[r*3+c];if(c)g.lineTo(a.x,a.y);else g.moveTo(a.x,a.y);}g.stroke();}
 for(let c=0;c<3;c++){g.beginPath();for(let r=0;r<3;r++){const a=vertices[r*3+c];if(r)g.lineTo(a.x,a.y);else g.moveTo(a.x,a.y);}g.stroke();}
 g.setLineDash([]);vertices.forEach((v,i)=>drawHandle(g,v,i===4?'#ffd177':'#68ddd1',6));
 }
}
function render(){if(!project)return;renderScene(ctx,currentFrame);renderControls();updateFrameDisplay();}
function updateFrameDisplay(){let sec=currentFrame/project.fps,whole=Math.floor(sec),centi=Math.floor((sec-whole)*100);$('frame-display').textContent=`${String(whole).padStart(2,'0')}:${String(centi).padStart(2,'0')} / ${String(Math.ceil(project.duration/project.fps)).padStart(2,'0')} s · f${Math.round(currentFrame)}`;}
function fitZoom(){const w=viewport.clientWidth-36,h=viewport.clientHeight-32;zoom=clamp(Math.min(w/project.width,h/project.height),.1,1.65);applyZoom();}
function applyZoom(){const w=Math.round(project.width*zoom),h=Math.round(project.height*zoom);stage.style.width=w+'px';stage.style.height=h+'px';$('zoom-display').textContent=Math.round(zoom*100)+'%';}
function resizeCanvas(){canvas.width=overlay.width=project.width;canvas.height=overlay.height=project.height;applyZoom();requestRender();}
function setFrame(frame){currentFrame=clamp(Math.round(frame),0,project.duration-1);renderControls();requestRender();renderPlayhead();syncProperties();}
function renderPlayhead(){$('playhead').style.left=(currentFrame*framesPerPx)+'px';if(playing){const sc=$('timeline-scroll'),x=currentFrame*framesPerPx;if(x<sc.scrollLeft||x>sc.scrollLeft+sc.clientWidth-40)sc.scrollLeft=Math.max(0,x-30);}}
function syncProperties(){
 const l=activeLayer();$('no-selection').classList.toggle('hidden',!!l);$('properties').classList.toggle('hidden',!l);
 if(!l)return;
 $('layer-name').value=l.name;$('layer-kind').value=l.kind;
 const select=$('layer-parent');select.innerHTML='<option value="">— Ninguna (raíz) —</option>';
 for(const layer of project.layers){if(layer.id===l.id || isDescendant(layer.id,l.id))continue;const opt=document.createElement('option');opt.value=layer.id;opt.textContent=layer.name;select.appendChild(opt);}
 select.value=l.parent||'';
 const p=poseAt(l);
 for(const [element,prop,mult] of [['pos-x','x',1],['pos-y','y',1],['angle','angle',1],['scale-x','scaleX',1],['scale-y','scaleY',1],['opacity','opacity',100],['pivot-x','pivotX',1],['pivot-y','pivotY',1]])$(element).value=round(p[prop]*mult);
}
function isDescendant(layerId,ancestorId){let node=findLayer(layerId),visited=new Set();while(node?.parent&&!visited.has(node.id)){if(node.parent===ancestorId)return true;visited.add(node.id);node=findLayer(node.parent);}return false;}
function setSelected(id){selectedId=id;renderLayers();syncProperties();renderTimeline();requestRender();}
function renderLayers(){
 const es=$('empty-state');if(es)es.hidden=project.layers.length>0;
 const host=$('layers');host.replaceChildren();$('layer-count').textContent=project.layers.length+' capas';
 for(let i=project.layers.length-1;i>=0;i--){const l=project.layers[i],row=document.createElement('div');row.className='layer'+(l.id===selectedId?' selected':'');row.dataset.id=l.id;
  const eye=document.createElement('button');eye.className='layer-visible';eye.textContent=l.visible?'◉':'○';eye.title=l.visible?'Ocultar':'Mostrar';eye.onclick=e=>{e.stopPropagation();pushUndo();l.visible=!l.visible;dirty();renderLayers();};
  const txt=document.createElement('span');txt.className='layer-name';txt.textContent=(l.parent?'↳ ':'')+l.name;
  const type=document.createElement('span');type.className='layer-kind';type.textContent=l.kind==='eye'?'👁':l.kind==='head'?'○':l.parent?'●':'■';
  row.append(eye,txt,type);row.onclick=()=>setSelected(l.id);host.appendChild(row);
 }
}
function renderTimeline(){
 const total=project.duration*framesPerPx, ruler=$('ruler'), list=$('track-list'), names=$('track-label-list');
 $('timeline-content').style.width=total+'px';ruler.replaceChildren();list.replaceChildren();names.replaceChildren();
 for(let f=0;f<project.duration;f+=4){const tick=document.createElement('span');tick.className='ruler-tick'+(f%12?' minor-tick':'');tick.style.left=f*framesPerPx+'px';if(f%12===0)tick.textContent=(f/project.fps).toFixed(1)+'s';ruler.append(tick);}
 const scrub=e=>{const r=ruler.getBoundingClientRect();setFrame((e.clientX-r.left)/framesPerPx);};
 ruler.onpointerdown=e=>{if(playing)stopPlayback();try{ruler.setPointerCapture(e.pointerId);}catch(_){}ruler._scrub=true;scrub(e);};ruler.onpointermove=e=>{if(ruler._scrub)scrub(e);};ruler.onpointerup=ruler.onpointercancel=()=>{ruler._scrub=false;};
 for(const l of project.layers.slice().reverse()){
  const name=document.createElement('div');name.className='track-name'+(l.id===selectedId?' selected':'');name.textContent=l.name;name.onclick=()=>setSelected(l.id);names.append(name);
  const row=document.createElement('div');row.className='track-row'+(l.id===selectedId?' selected':'');row.dataset.id=l.id;row.onclick=e=>{setSelected(l.id);const rect=row.getBoundingClientRect();setFrame((e.clientX-rect.left)/framesPerPx);};
  for(const key of Object.keys(l.keys||{})){
   const f=Number(key);if(f<0||f>=project.duration)continue;
   const d=document.createElement('span');d.className='diamond'+(Math.abs(f-currentFrame)<.5?' selected-key':'');d.style.left=f*framesPerPx+'px';d.title='Fotograma '+f;d.onclick=e=>{e.stopPropagation();setSelected(l.id);setFrame(f);};row.append(d);
  }list.append(row);
 }
 renderPlayhead();
}
function refreshSidebar(){ $('project-name').value=project.name;$('fps').value=project.fps;$('seconds').value=round(project.duration/project.fps);$('blink-enabled').checked=project.blink.enabled;$('blink-interval').value=project.blink.interval;$('blink-duration').value=project.blink.duration;$('format').value=project.format;$('bg-color').value=project.background;$('btn-background').classList.toggle('active',project.showBackground);$('project-size').textContent=project.width+' × '+project.height;renderLayers();syncProperties();renderTimeline();}
async function loadProject(data, resetHistory=true){
 if(!data || !Array.isArray(data.layers) || !data.width || !data.height)throw Error('Archivo de proyecto inválido');
 const next=cloneProject(data);for(const l of next.layers){if(!l||!l.base||typeof l.dataUrl!=='string'||!l.id)throw Error('Una capa del archivo está dañada');}next.version=1;next.width=clamp(Math.round(num(next.width,800)),64,4096);next.height=clamp(Math.round(num(next.height,800)),64,4096);next.fps=clamp(Math.round(num(next.fps,24)),6,60);next.duration=clamp(Math.round(num(next.duration,120)),next.fps,next.fps*30);next.blink=next.blink||{enabled:true,interval:3,duration:0.2};next.showBackground=!!next.showBackground;next.format=next.format||'square';
 next.layers.forEach(l=>{l.keys=l.keys||{};l.parent=l.parent||null;l.visible=l.visible!==false;l.base.mesh=l.base.mesh?.length===9?l.base.mesh:blankMesh();for(const key of Object.keys(l.keys))l.keys[key].mesh=l.keys[key].mesh?.length===9?l.keys[key].mesh:blankMesh();});
 const ids=new Set(next.layers.map(l=>l.id));next.layers.forEach(l=>{if(!ids.has(l.parent)||l.parent===l.id)l.parent=null;});
 const byId=new Map(next.layers.map(l=>[l.id,l]));
 for(const layer of next.layers){const seen=new Set([layer.id]);let current=layer;while(current.parent){if(seen.has(current.parent)){current.parent=null;break;}seen.add(current.parent);current=byId.get(current.parent);if(!current)break;}}

 project=next;for(const id of [...cache.keys()])if(!ids.has(id))cache.delete(id);if(resetHistory){undoStack=[];redoStack=[];currentFrame=0;selectedId=null;}if(selectedId&&!ids.has(selectedId))selectedId=null;
 await ensureImages();resizeCanvas();fitZoom();refreshSidebar();updateHistoryButtons();render();
}
function downloadJSON(){try{const blob=new Blob([JSON.stringify(capture(),null,2)],{type:'application/json'});B.download(blob,B.cleanName(project.name)+'.gmotion.json');toast('Copia enviada a Descargas; comprueba el archivo .gmotion.json');void saveNow();}catch(e){toast('Error al generar copia: '+e.message,true);}}
async function importProjectFile(file){try{const p=JSON.parse(await B.readFile(file,'text'));if(p.version!==1)throw Error('Formato desconocido');await loadProject(p,true);saveSoon();toast('Proyecto recuperado con '+p.layers.length+' capas');}catch(e){toast('No se pudo cargar: '+e.message,true);}}
function layerKind(name){const s=name.toLowerCase();if(/ojos?|eyes?|eye/.test(s))return 'eye';if(/cabeza|head|rostro|face/.test(s))return 'head';if(/boca|mouth|labios/.test(s))return 'mouth';if(/cuerpo|torso|pecho/.test(s))return 'torso';if(/brazo.*izq|arm.*left|left.*arm/.test(s))return 'arm-left';if(/brazo.*der|arm.*right|right.*arm/.test(s))return 'arm-right';if(/pierna|leg/.test(s))return 'leg';if(/pelo|hair|flequillo/.test(s))return 'hair';return 'generic';}
async function importLayers(files){
 if(!files.length)return;pushUndo();
 const errors=[];for(const file of files){if(!file.type.startsWith('image/')){errors.push(file.name);continue;}try{
  const url=await B.readFile(file),img=await B.imageFromUrl(url),asset=B.compactImage(img,1400),name=file.name.replace(/\.[^.]+$/,'');
  const l=createLayer(name,layerKind(name),null,asset,project.width/2,project.height/2,asset.width/2,asset.height/2);
  project.layers.push(l);await loadImage(l);selectedId=l.id;
 }catch(e){errors.push(file.name);}}
 renderLayers();refreshSidebar();dirty();toast(`${files.length-errors.length} capa(s) importada(s)${errors.length?' · '+errors.length+' con errores':''}`);
}
function hitLayer(x,y){
 for(let i=project.layers.length-1;i>=0;i--){const l=project.layers[i];if(!l.visible||!imageFor(l))continue;
 const inv=inverse(matrixFor(l)),local=apply(inv,x,y),pose=poseAt(l),u=local.x+pose.pivotX,v=local.y+pose.pivotY;
 if(u<0||v<0||u>=l.width||v>=l.height)continue;
 const entry=cache.get(l.id);if(entry){try{
  if(!entry.alpha){const c=B.makeCanvas(160,160),a=c.getContext('2d',{willReadFrequently:true});a.drawImage(entry.image,0,0,160,160);entry.alpha=a.getImageData(0,0,160,160).data;}
  const px=clamp(Math.floor(u/l.width*160),0,159),py=clamp(Math.floor(v/l.height*160),0,159);
  if(entry.alpha[(py*160+px)*4+3]<45)continue;
 }catch(e){/* fallback to bounding-box hit test */}}
 return l;
 }return null;
}
function cursorCanvas(e){const rect=overlay.getBoundingClientRect();return {x:(e.clientX-rect.left)*project.width/rect.width,y:(e.clientY-rect.top)*project.height/rect.height};}
function near(a,b,px=13){return Math.hypot(a.x-b.x,a.y-b.y)<px/zoom;}
function rotationHandle(layer){const corners=layerCorners(layer),p=apply(matrixFor(layer),0,0),mid={x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2};const dx=mid.x-p.x,dy=mid.y-p.y,d=Math.max(1,Math.hypot(dx,dy));return {x:mid.x+dx/d*27,y:mid.y+dy/d*27};}
function onPointerDown(e){if(!project||exportBusy)return; e.preventDefault();const pos=cursorCanvas(e);let l=activeLayer();
 const selected=l&&l.visible&&((tool==='pivot'&&near(pos,apply(matrixFor(l),0,0)))||(tool==='rotate'&&near(pos,rotationHandle(l)))||(tool==='warp'&&meshVertices(l,poseAt(l),matrixFor(l)).some(p=>near(pos,p))));
 if(!selected){const clicked=hitLayer(pos.x,pos.y);if(clicked){l=clicked;if(l.id!==selectedId)setSelected(l.id);}}
 if(!l)return;
 const pose=poseAt(l),m=matrixFor(l);let mode=tool,vertexIndex=-1;
 if(tool==='warp'){const pts=meshVertices(l,pose,m);vertexIndex=pts.findIndex(v=>near(pos,v));if(vertexIndex<0)mode='move';}
 if(tool==='pivot'&&!near(pos,apply(m,0,0)))mode='move';
 if(tool==='rotate'&&!near(pos,rotationHandle(l)))mode='rotate';
 if(!selected && !hitLayer(pos.x,pos.y) && mode!=='warp')return;
 if(dragging)finishDrag();
 const parent=l.parent?findLayer(l.parent):null,origin=apply(m,0,0);
 dragging={id:l.id,mode,start:pos,pose:clone(pose),matrix:m,parentMatrix:parent?matrixFor(parent):identity,vertexIndex,moved:false,prevAngle:Math.atan2(pos.y-origin.y,pos.x-origin.x),turn:0,sx:e.clientX,sy:e.clientY};
 try{overlay.setPointerCapture(e.pointerId);}catch(_){}
}
function onPointerMove(e){if(!dragging)return; e.preventDefault();if(e.pointerType!=='touch'&&e.buttons===0){finishDrag(e);return;}const pos=cursorCanvas(e),l=findLayer(dragging.id);if(!l)return;
 if(!dragging.moved){if(Math.hypot(e.clientX-dragging.sx,e.clientY-dragging.sy)<3)return;dragging.moved=true;pushUndo();changeRevision++;status('Cambios pendientes…');}
 const d=dragging,p=clone(d.pose),origin=apply(d.matrix,0,0);
 if(d.mode==='rotate'){
  const now=Math.atan2(pos.y-origin.y,pos.x-origin.x);let step=now-d.prevAngle;if(step>Math.PI)step-=2*Math.PI;if(step<-Math.PI)step+=2*Math.PI;d.turn+=step;d.prevAngle=now;
  p.angle=round(d.pose.angle+d.turn*180/Math.PI);
 } else if(d.mode==='pivot'){
  const local=apply(inverse(d.matrix),pos.x,pos.y),initial=apply(inverse(d.matrix),d.start.x,d.start.y);
  const deltaX=local.x-initial.x,deltaY=local.y-initial.y;
  p.pivotX=round(d.pose.pivotX+deltaX);p.pivotY=round(d.pose.pivotY+deltaY);
  const a=d.pose.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  p.x=round(d.pose.x+c*d.pose.scaleX*deltaX-s*d.pose.scaleY*deltaY);
  p.y=round(d.pose.y+s*d.pose.scaleX*deltaX+c*d.pose.scaleY*deltaY);
 } else if(d.mode==='warp'&&d.vertexIndex>=0){
  const local=apply(inverse(d.matrix),pos.x,pos.y),i=d.vertexIndex;
  p.mesh[i].dx=round(local.x-((i%3)*l.width/2-d.pose.pivotX));
  p.mesh[i].dy=round(local.y-(Math.floor(i/3)*l.height/2-d.pose.pivotY));
 } else {
  const pinv=inverse(d.parentMatrix),s=apply(pinv,d.start.x,d.start.y),end=apply(pinv,pos.x,pos.y);
  p.x=round(d.pose.x+end.x-s.x);p.y=round(d.pose.y+end.y-s.y);
 }
 setPose(l,p);syncProperties();requestRender();
}
function finishDrag(e){const moved=dragging&&dragging.moved;dragging=null;try{if(e&&overlay.hasPointerCapture(e.pointerId))overlay.releasePointerCapture(e.pointerId);}catch(_){}if(moved){renderTimeline();saveSoon();void saveNow();}}
function onPointerUp(e){if(!dragging)return;finishDrag(e);}
function demoAsset(w,h,draw){const c=B.makeCanvas(w,h),g=c.getContext('2d');g.lineJoin='round';g.lineCap='round';draw(g);return{dataUrl:c.toDataURL('image/png'),width:w,height:h};}
function circle(g,x,y,r,color){g.fillStyle=color;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();}
function ellipse(g,x,y,rx,ry,fill,stroke=null,line=2){g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);g.fillStyle=fill;g.fill();if(stroke){g.lineWidth=line;g.strokeStyle=stroke;g.stroke();}}
function rounded(g,x,y,w,h,r,fill,stroke=null){g.beginPath();g.roundRect(x,y,w,h,r);g.fillStyle=fill;g.fill();if(stroke){g.strokeStyle=stroke;g.lineWidth=2.4;g.stroke();}}
function path(g,points,fill,stroke=null,line=3){g.beginPath();g.moveTo(...points[0]);for(let i=1;i<points.length;i++)g.lineTo(...points[i]);g.closePath();g.fillStyle=fill;g.fill();if(stroke){g.strokeStyle=stroke;g.lineWidth=line;g.stroke();}}
function ombre(g,x0,y0,x1,y1,stops){const grd=g.createLinearGradient(x0,y0,x1,y1);stops.forEach(([s,col])=>grd.addColorStop(s,col));return grd;}
function createDemoProject(){
 const P=newProject();P.name='Luna · personaje de ejemplo';const layers=P.layers;
 const assets={
  backhair:demoAsset(226,250,g=>{
   path(g,[[39,61],[44,28],[76,9],[120,5],[170,17],[194,48],[200,105],[213,227],[175,216],[155,233],[113,208],[73,233],[39,216],[20,228],[25,128]],ombre(g,0,0,0,240,[[0,'#553484'],[.6,'#6f4caf'],[1,'#32235e']]),'#382957',4);
   for(let i=0;i<5;i++)path(g,[[48+i*27,122],[57+i*26,170],[40+i*28,217],[67+i*22,203]],'#6c49ab','#62449c',1);
  }),
  legL:demoAsset(76,194,g=>{
   rounded(g,19,17,39,138,19,ombre(g,0,0,40,190,[[0,'#dccbf2'],[1,'#9e8fce']]),'#655786');
   rounded(g,16,118,43,49,12,'#5f4b89','#43345c');
   ellipse(g,31,166,28,18,'#5f4b89','#382b55');rounded(g,20,130,34,9,5,'#8672b9');
  }),
  legR:demoAsset(76,194,g=>{
   rounded(g,19,17,39,138,19,ombre(g,0,0,40,190,[[0,'#dccbf2'],[1,'#9e8fce']]),'#655786');
   rounded(g,16,118,43,49,12,'#5f4b89','#43345c');ellipse(g,43,166,28,18,'#5f4b89','#382b55');rounded(g,20,130,34,9,5,'#8672b9');
  }),
  armL:demoAsset(81,188,g=>{
   ellipse(g,42,37,34,34,'#7b91c5','#596990',3);
   path(g,[[18,28],[57,28],[66,112],[58,133],[37,144],[21,128]],ombre(g,0,0,70,160,[[0,'#748bc1'],[1,'#435781']]),'#394969',3);
   ellipse(g,43,145,19,29,'#f7c6ac','#c99386',2.4);ellipse(g,43,167,16,12,'#f7c6ac');
   rounded(g,19,126,45,11,5,'#c6b1e5','#79699e');
  }),
  armR:demoAsset(81,188,g=>{
   ellipse(g,39,37,34,34,'#7b91c5','#596990',3);
   path(g,[[21,28],[60,28],[67,124],[48,144],[27,133],[14,111]],ombre(g,0,0,60,155,[[0,'#748bc1'],[1,'#435781']]),'#394969',3);
   ellipse(g,39,145,19,29,'#f7c6ac','#c99386',2.4);ellipse(g,39,167,16,12,'#f7c6ac');
   rounded(g,17,126,45,11,5,'#c6b1e5','#79699e');
  }),
  torso:demoAsset(200,245,g=>{
   rounded(g,82,0,35,46,13,'#f3c1a8','#c88e86');
   path(g,[[31,35],[65,17],[136,17],[167,35],[173,110],[158,202],[44,202],[25,110]],ombre(g,20,20,150,210,[[0,'#7b91cb'],[.58,'#526ba4'],[1,'#3c507a']]),'#314568',4);
   path(g,[[68,17],[100,71],[134,17],[112,20],[100,47],[89,20]],'#f6e7fb','#d9d0f6',2);
   path(g,[[98,55],[110,75],[110,161],[100,175],[90,161],[90,75]],'#c5a8ed','#9474c1',2);
   rounded(g,39,172,121,24,8,'#384d7d','#29395c');circle(g,101,183,9,'#ffe3a0');
   for(let i=0;i<4;i++)circle(g,135,65+i*27,3.3,'#c4cdea');
  }),
  skirt:demoAsset(225,132,g=>{
   path(g,[[38,10],[187,10],[213,112],[170,120],[126,125],[80,120],[13,113]],ombre(g,0,10,180,130,[[0,'#758bc2'],[.6,'#a2a4de'],[1,'#6b6daa']]),'#4f5582',3);
   path(g,[[51,26],[72,120],[87,124],[82,28]],'#afafe0');path(g,[[140,24],[146,123],[166,120],[164,26]],'#818bc6');
   g.beginPath();g.moveTo(16,105);g.quadraticCurveTo(111,136,211,105);g.strokeStyle='#d0c3ed';g.lineWidth=6;g.stroke();
  }),
  head:demoAsset(194,204,g=>{
   ellipse(g,13,105,14,26,'#f4c0a6','#c88f83',2);ellipse(g,181,105,14,26,'#f4c0a6','#c88f83',2);
   g.beginPath();g.moveTo(96,13);g.bezierCurveTo(164,7,176,55,171,126);g.bezierCurveTo(159,173,120,193,96,193);g.bezierCurveTo(72,193,35,173,23,126);g.bezierCurveTo(9,52,32,10,96,13);g.closePath();
   g.fillStyle=ombre(g,10,20,165,190,[[0,'#ffe1c8'],[.6,'#f5bea9'],[1,'#df9e92']]);g.fill();g.lineWidth=3;g.strokeStyle='#bd8b84';g.stroke();
   ellipse(g,49,125,18,8,'#f5a4a9');ellipse(g,145,125,18,8,'#f5a4a9');
   path(g,[[98,121],[93,130],[100,132]],'#d99991');circle(g,52,144,2,'#fff3ec');circle(g,145,141,2,'#fff3ec');
  }),
  eyeL:demoAsset(44,39,g=>{
   ellipse(g,22,20,17.5,15,'#fff7f2','#644e68',2.5);ellipse(g,24,20,11,13,'#679db4','#3c638f',2);ellipse(g,25,20,5.8,10,'#1a314a');circle(g,27,14,4,'#ffffff');circle(g,20,23,2,'#d8ffff');
   g.beginPath();g.moveTo(6,14);g.quadraticCurveTo(22,-1,39,12);g.strokeStyle='#4c365c';g.lineWidth=4;g.stroke();
  }),
  eyeR:demoAsset(44,39,g=>{
   ellipse(g,22,20,17.5,15,'#fff7f2','#644e68',2.5);ellipse(g,20,20,11,13,'#679db4','#3c638f',2);ellipse(g,19,20,5.8,10,'#1a314a');circle(g,23,14,4,'#ffffff');circle(g,17,24,2,'#d8ffff');
   g.beginPath();g.moveTo(6,12);g.quadraticCurveTo(22,-1,39,14);g.strokeStyle='#4c365c';g.lineWidth=4;g.stroke();
  }),
  mouth:demoAsset(46,28,g=>{g.beginPath();g.moveTo(10,10);g.quadraticCurveTo(23,23,36,10);g.strokeStyle='#9e5b70';g.lineWidth=3.6;g.stroke();circle(g,23,17,3,'#e8a2a5');}),
  frontHair:demoAsset(220,149,g=>{
   path(g,[[25,95],[16,58],[31,27],[70,11],[120,4],[179,18],[206,42],[197,107],[179,78],[163,118],[141,93],[116,128],[97,97],[60,126],[44,87]],ombre(g,20,10,200,130,[[0,'#724ba9'],[.4,'#5b3a8c'],[1,'#3d2c72']]),'#342759',4);
   path(g,[[65,24],[97,10],[85,91],[58,118]],'#8060b7');path(g,[[153,15],[177,28],[162,92],[141,106]],'#65448e');
   path(g,[[92,6],[119,4],[102,85]],'#8d66c4');
  }),
  bow:demoAsset(65,50,g=>{path(g,[[32,21],[5,3],[7,40],[31,27]],'#a7e4ce','#4f8d92',2);path(g,[[32,21],[58,3],[57,41],[32,27]],'#a7e4ce','#4f8d92',2);circle(g,32,23,9,'#e9e1a7');})
 };
 const add=(name,kind,parent,asset,x,y,px,py)=>{const par=parent?layers.find(l=>l.name===parent)?.id:null;const l=createLayer(name,kind,par,assets[asset],x,y,px,py);layers.push(l);return l;};
 add('Pelo posterior','hair','Cabeza','backhair',0,-6,113,169); // parent resolved after head creation below
 add('Pierna izquierda','leg','Cuerpo','legL',-38,181,38,16);
 add('Pierna derecha','leg','Cuerpo','legR',39,181,38,16);
 add('Brazo izquierdo','arm-left','Cuerpo','armL',-79,-13,42,30);
 add('Cuerpo','torso',null,'torso',400,390,100,44);
 add('Falda','generic','Cuerpo','skirt',0,156,112,12);
 add('Brazo derecho','arm-right','Cuerpo','armR',79,-13,39,30);
 add('Cabeza','head','Cuerpo','head',0,-68,96,160);
 add('Ojo izquierdo','eye','Cabeza','eyeL',-34,-52,22,20);
 add('Ojo derecho','eye','Cabeza','eyeR',34,-52,22,20);
 add('Boca','mouth','Cabeza','mouth',0,-9,23,14);
 add('Flequillo','hair','Cabeza','frontHair',0,-82,110,114);
 add('Lazo del pelo','generic','Cabeza','bow',78,-118,32,24);
 // Resolve parent relationships after all pieces exist (including parts behind the head).
 const byName=new Map(layers.map(l=>[l.name,l.id]));
 for(const l of layers){if(['Pierna izquierda','Pierna derecha','Brazo izquierdo','Falda','Brazo derecho'].includes(l.name))l.parent=byName.get('Cuerpo');else if(['Pelo posterior','Ojo izquierdo','Ojo derecho','Boca','Flequillo','Lazo del pelo'].includes(l.name))l.parent=byName.get('Cabeza');}
 // Delicate blink and movement demo: keep all layers editable and without pre-recorded keys.
 return P;
}
function addPreset(kind){
 const chosen=kind==='wave'?project.layers.find(l=>l.kind==='arm-right'):
 kind==='nod'?project.layers.find(l=>l.kind==='head'):
 kind==='breathe'?project.layers.find(l=>l.kind==='torso'):
 kind==='sway'?(activeLayer()||project.layers.find(l=>l.kind==='hair')):
 project.layers.find(l=>l.kind==='torso'&&!l.parent)||project.layers[0];
 if(!chosen){toast('No hay una pieza adecuada para este movimiento. Asigna su tipo en Propiedades.',true);return;}
 pushUndo();
 const starter=clone(chosen.base);
 const patterns={wave:[[0,0],[6,-80],[11,-112],[15,-85],[19,-112],[23,-85],[28,-112],[37,0]],nod:[[0,0],[8,13],[16,-8],[24,8],[32,0]],breathe:[[0,1],[12,1.04],[24,1],[36,1.04],[48,1]],jump:[[0,0],[7,12],[15,-66],[22,-72],[34,0],[40,9],[47,0]],sway:[[0,0],[10,12],[20,-11],[30,10],[40,0]]};
 for(const [frame,val] of patterns[kind]){
  if(frame>=project.duration)continue;
  const pose=clone(starter);
  if(kind==='wave'||kind==='nod')pose.angle=starter.angle+val;
  if(kind==='breathe')pose.scaleY=starter.scaleY*val;
  if(kind==='jump')pose.y=starter.y+val;
  if(kind==='sway'){for(let i=0;i<9;i++){const row=Math.floor(i/3);pose.mesh[i].dx=starter.mesh[i].dx+val*(row/2);pose.mesh[i].dy=starter.mesh[i].dy+(i%3===1?Math.abs(val)*.14:0);}}
  setKey(chosen,frame,pose);
 }
 setSelected(chosen.id);setFrame(0);renderTimeline();dirty();toast('Animación «'+({wave:'Saludar',nod:'Asentir',breathe:'Respirar',jump:'Saltar',sway:'Flexión suave'}[kind])+'» añadida');
}
function playToggle(){if(playing){stopPlayback();return;}playing=true;lastTick=performance.now();$('btn-play').textContent='⏸ Pausar';const tick=now=>{if(!playing)return;const elapsed=now-lastTick;lastTick=now;frameTimer+=elapsed;const step=1000/project.fps;while(frameTimer>=step){currentFrame=(currentFrame+1)%project.duration;frameTimer-=step;}requestRender();renderPlayhead();requestAnimationFrame(tick);};requestAnimationFrame(tick);}
function stopPlayback(){playing=false;frameTimer=0;$('btn-play').textContent='▶ Reproducir';syncProperties();renderTimeline();}
function exportPNG(){if(!project.layers.length){toast('Importa alguna pieza antes de exportar',true);return;}const out=B.makeCanvas(project.width,project.height);renderScene(out.getContext('2d'),currentFrame);out.toBlob(blob=>{if(blob){B.download(blob,B.cleanName(project.name)+'_f'+currentFrame+'.png');toast('Imagen PNG exportada');}else toast('No se pudo generar el PNG',true);},'image/png');}
async function exportWebM(){
 if(exportBusy)return;if(!project.layers.length){toast('Importa alguna pieza antes de exportar',true);return;}
 if(typeof MediaRecorder==='undefined'||!('captureStream' in HTMLCanvasElement.prototype)){toast('Este navegador no permite grabar vídeo. Usa Chrome o Edge.',true);return;}
 const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));
 if(!mime){toast('Este navegador no es compatible con WebM',true);return;}
 exportBusy=true;stopPlayback();const btn=$('btn-video');btn.disabled=true;const oldLabel=btn.textContent;btn.textContent='Grabando…';
 let stream,recorder;
 try {
  const out=B.makeCanvas(project.width,project.height),g=out.getContext('2d');renderScene(g,0);
  stream=out.captureStream(0);const track=stream.getVideoTracks()[0];if(!track?.requestFrame)throw Error('Este navegador no admite exportar fotograma a fotograma');
  recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3500000});
  const pieces=[];recorder.ondataavailable=e=>{if(e.data?.size)pieces.push(e.data);};
  const ended=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=e=>reject(Error('Error al grabar: '+(e.error?.message||'')));});
  recorder.start();
  // MediaRecorder necesita tiempo real para asignar marcas de tiempo válidas al archivo.
  for(let f=0;f<project.duration;f++){
   renderScene(g,f);track.requestFrame();btn.textContent=`Vídeo ${Math.floor(100*(f+1)/project.duration)}%`;
   await new Promise(r=>setTimeout(r,1000/project.fps));
  }
  renderScene(g,project.duration-1);track.requestFrame();await new Promise(r=>setTimeout(r,300));
  recorder.stop();await ended;
  const blob=new Blob(pieces,{type:mime});if(blob.size<100)throw Error('El vídeo resultante está vacío');
  B.download(blob,B.cleanName(project.name)+'.webm');toast('Vídeo WebM exportado ('+(blob.size/1024/1024).toFixed(1)+' MB)');
 }catch(e){toast('Error de exportación: '+e.message,true);if(recorder?.state==='recording')recorder.stop();}
 finally {stream?.getTracks().forEach(t=>t.stop());btn.disabled=false;btn.textContent=oldLabel;exportBusy=false;}
}
async function sendToPaint(){try{if(!project.layers.length){toast('Aún no hay piezas que enviar',true);return;}if(!await saveNow())throw Error('No se pudo guardar el proyecto de animación');const out=B.makeCanvas(project.width,project.height);renderScene(out.getContext('2d'),currentFrame,project.width,project.height,false);await B.send({type:'flat-image',name:project.name+'_fotograma',width:project.width,height:project.height,dataUrl:out.toDataURL('image/png')});navigationAllowed=true;window.location.href='../dibujo/index.html?transfer=1';}catch(e){toast('No se pudieron transferir las capas: '+e.message,true);}}
async function acceptTransferredArt(){if(!location.search.includes('transfer'))return;
 try{const transfer=await B.receive();if(!transfer)return;
  if(!['layered-art','flat-image'].includes(transfer.type))return;
  pushUndo();
  if(transfer.type==='flat-image'){
   const img=await B.imageFromUrl(transfer.dataUrl);const compact=B.compactImage(img);
   const l=createLayer(transfer.name||'Dibujo', 'generic',null,compact,project.width/2,project.height/2,compact.width/2,compact.height/2);
   project.layers.push(l);await loadImage(l);selectedId=l.id;
  } else {
   const centerX=project.width/2,centerY=project.height/2;
   for(const item of transfer.layers){if(!item.dataUrl)continue;
    const image=await B.imageFromUrl(item.dataUrl),compact=B.compactImage(image),resize=compact.width/image.width;
    const rx=project.width/(transfer.width||project.width),ry=project.height/(transfer.height||project.height);
    const px=num(item.pivotX,image.width/2)*resize,py=num(item.pivotY,image.height/2)*resize;
    const cx=num(item.x,(transfer.width||project.width)/2)*rx,cy=num(item.y,(transfer.height||project.height)/2)*ry;
    const l=createLayer(item.name||'Capa',layerKind(item.name||''),null,compact,cx,cy,px,py);
    l.base.scaleX=rx/resize;l.base.scaleY=ry/resize;
    project.layers.push(l);await loadImage(l);selectedId=l.id;
   }
  }
  refreshSidebar();dirty();toast('Dibujo recibido del otro editor');
 }catch(e){toast('No se pudo abrir la transferencia: '+e.message,true);}
}
function changeFormat(value){
 const formats={square:[800,800],portrait:[720,1280],landscape:[1280,720]};if(!formats[value])return;
 pushUndo();const [w,h]=formats[value],rx=w/project.width,ry=h/project.height;
 for(const l of project.layers){if(l.parent)continue;
  l.base.x*=rx;l.base.y*=ry;
  for(const key of Object.values(l.keys)){key.x*=rx;key.y*=ry;}
 }
 project.width=w;project.height=h;project.format=value;resizeCanvas();fitZoom();refreshSidebar();dirty();
}
function changeParent(id){const l=activeLayer();if(!l)return;if(id===l.id||isDescendant(id,l.id)){toast('Una capa no puede unirse a sí misma ni a sus descendientes.',true);return;}
 pushUndo();const old=matrixFor(l),p=poseAt(l);
 l.parent=id||null;const newParent=l.parent?matrixFor(findLayer(l.parent)):identity;
 const local=mul(inverse(newParent),old),sx=Math.hypot(local[0],local[1]);
 p.x=round(local[4]);p.y=round(local[5]);p.angle=round(Math.atan2(local[1],local[0])*180/Math.PI);p.scaleX=round(sx);p.scaleY=round((local[0]*local[3]-local[1]*local[2])/Math.max(.001,sx));
 setPose(l,p);refreshSidebar();dirty();
}
// Lo que quede del muñeco de ejemplo (sin animar) guardado de antes no se vuelve a abrir solo; tus propias piezas sí
function looksUntouchedDemo(p){if(!p||!Array.isArray(p.layers)||!p.layers.length)return false;const d=new Map(createDemoProject().layers.map(l=>[l.name,l.width+'x'+l.height]));return p.layers.every(l=>l&&d.get(l.name)===l.width+'x'+l.height&&(!l.keys||!Object.keys(l.keys).length));}
function deleteSelected(){
 const l=activeLayer();if(!l){toast('Elige primero la capa que quieres eliminar');return;}
 const i=project.layers.indexOf(l);pushUndo();
 project.layers=project.layers.filter(o=>o.id!==l.id);
 for(const item of project.layers){if(item.parent===l.id)item.parent=l.parent&&project.layers.some(o=>o.id===l.parent)?l.parent:null;}
 cache.delete(l.id);selectedId=project.layers.length?project.layers[Math.max(0,i-1)].id:null;
 refreshSidebar();dirty();
 GMUI.aviso('Capa «'+l.name+'» eliminada','Deshacer',()=>undo());
}
async function showDemo(){
 if(project.layers.length&&!await GMUI.confirmar('¿Sustituir lo que hay por el personaje de ejemplo? Descarga antes una copia si no quieres perderlo (también puedes Deshacer).','Ver el ejemplo'))return;
 pushUndo();await loadProject(createDemoProject(),false);saveSoon();toast('Personaje de ejemplo cargado');
}
async function goPaint(){if(!await saveNow())return;navigationAllowed=true;location.href='../dibujo/index.html';}
function setupUI(){
 $('project-name').onchange=e=>{const name=e.target.value.trim()||'Mi personaje';if(project.name!==name){pushUndo();project.name=name;saveSoon();}};
 document.querySelector('a.home').addEventListener('click', async e=>{if(window.parent!==window){e.preventDefault();if(!await saveNow())return;navigationAllowed=true;window.parent.postMessage({gmstudio:1,action:'home'},'*');}});
 $('btn-demo').onclick=showDemo;$('es-demo').onclick=showDemo;$('es-import').onclick=()=>$('file-layers').click();$('es-load').onclick=()=>$('file-project').click();$('es-paint').onclick=goPaint;
 $('btn-import').onclick=()=>$('file-layers').click();$('file-layers').onchange=e=>{importLayers(Array.from(e.target.files));e.target.value='';};
 $('btn-save').onclick=downloadJSON;$('btn-verify').onclick=verifySave;$('btn-load').onclick=()=>$('file-project').click();
 $('file-project').onchange=e=>{if(e.target.files[0])importProjectFile(e.target.files[0]);e.target.value='';};
 $('btn-undo').onclick=undo;$('btn-redo').onclick=redo;
 $('btn-frame-png').onclick=exportPNG;$('btn-video').onclick=exportWebM;$('btn-paint').onclick=sendToPaint;
 document.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>{tool=button.dataset.tool;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b===button));requestRender();});
 document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>addPreset(b.dataset.preset));
 $('layer-up').onclick=()=>{const l=activeLayer();if(!l)return;const i=project.layers.indexOf(l);if(i>=project.layers.length-1)return;pushUndo();project.layers.splice(i,1);project.layers.splice(i+1,0,l);refreshSidebar();dirty();};
 $('layer-down').onclick=()=>{const l=activeLayer();if(!l)return;const i=project.layers.indexOf(l);if(i<=0)return;pushUndo();project.layers.splice(i,1);project.layers.splice(i-1,0,l);refreshSidebar();dirty();};
 $('layer-duplicate').onclick=async()=>{const l=activeLayer();if(!l)return;pushUndo();const i=project.layers.indexOf(l),copy=clone(l);copy.id=uid();copy.name+=' (copia)';copy.base.x+=20;copy.base.y+=20;project.layers.splice(i+1,0,copy);selectedId=copy.id;await loadImage(copy);refreshSidebar();dirty();};
 $('layer-delete').onclick=deleteSelected;
 $('layer-name').onchange=e=>{const l=activeLayer();if(!l)return;pushUndo();l.name=e.target.value.trim()||'Capa';refreshSidebar();dirty();};
 $('layer-kind').onchange=e=>{const l=activeLayer();if(!l)return;pushUndo();l.kind=e.target.value;dirty();renderLayers();};
 $('layer-parent').onchange=e=>changeParent(e.target.value);
 for(const [id,field,divisor] of [['pos-x','x',1],['pos-y','y',1],['angle','angle',1],['scale-x','scaleX',1],['scale-y','scaleY',1],['opacity','opacity',100],['pivot-x','pivotX',1],['pivot-y','pivotY',1]]){
  $(id).onchange=e=>{let v=num(e.target.value);if(field==='opacity')v=clamp(v/100,0,1);else {v/=divisor;if(['scaleX','scaleY'].includes(field))v=clamp(v,.05,10);}updatePose(field,v);};
 }
 $('btn-reset-warp').onclick=()=>{const l=activeLayer();if(!l)return;pushUndo();const p=poseAt(l);p.mesh=blankMesh();setPose(l,p,true);};
 $('btn-reset-transform').onclick=()=>{const l=activeLayer();if(!l)return;pushUndo();const p=poseAt(l);p.scaleX=p.scaleY=1;p.angle=0;p.opacity=1;setPose(l,p,true);};
 $('blink-enabled').onchange=e=>{pushUndo();project.blink.enabled=e.target.checked;dirty();};
 $('blink-interval').onchange=e=>{pushUndo();project.blink.interval=clamp(num(e.target.value,3),.5,20);refreshSidebar();dirty();};
 $('blink-duration').onchange=e=>{pushUndo();project.blink.duration=clamp(num(e.target.value,.2),.08,1);refreshSidebar();dirty();};
 $('fps').onchange=e=>{pushUndo();project.fps=clamp(Math.round(num(e.target.value,24)),6,60);refreshSidebar();dirty();};
 $('seconds').onchange=e=>{pushUndo();project.duration=clamp(Math.round(num(e.target.value,5)*project.fps),project.fps,30*project.fps);currentFrame=Math.min(currentFrame,project.duration-1);refreshSidebar();dirty();};
 $('format').onchange=e=>changeFormat(e.target.value);
 $('bg-color').onchange=e=>{pushUndo();project.background=e.target.value;dirty();};
 $('btn-bones').onclick=()=>{showBones=!showBones;$('btn-bones').classList.toggle('active',showBones);requestRender();};
 $('btn-background').onclick=()=>{pushUndo();project.showBackground=!project.showBackground;$('btn-background').classList.toggle('active',project.showBackground);dirty();};
 $('btn-zoom-in').onclick=()=>{zoom=clamp(zoom*1.2,.1,3);applyZoom();};
 $('btn-zoom-out').onclick=()=>{zoom=clamp(zoom/1.2,.1,3);applyZoom();};
 $('btn-fit').onclick=fitZoom;
 $('btn-play').onclick=playToggle;$('btn-to-start').onclick=()=>{stopPlayback();setFrame(0);};
 $('btn-to-end').onclick=()=>{stopPlayback();setFrame(project.duration-1);};$('btn-prev').onclick=()=>{stopPlayback();setFrame(currentFrame-1);};$('btn-next').onclick=()=>{stopPlayback();setFrame(currentFrame+1);};
 $('auto-key').onchange=e=>{autoKey=e.target.checked;toast(autoKey?'AUTO KEY: los cambios crean fotogramas':'AUTO KEY desactivado: editas la pose base');};
 $('btn-keyframe').onclick=()=>{const l=activeLayer();if(!l)return;pushUndo();setKey(l,currentFrame,poseAt(l));renderTimeline();saveSoon();toast('Fotograma ◆ añadido en f'+currentFrame);};
 $('btn-del-keyframe').onclick=()=>{const l=activeLayer();if(!l||!Object.hasOwn(l.keys,currentFrame))return;pushUndo();delete l.keys[currentFrame];renderTimeline();dirty();toast('Fotograma eliminado');};
 overlay.addEventListener('pointerdown',onPointerDown);overlay.addEventListener('pointermove',onPointerMove);overlay.addEventListener('pointerup',onPointerUp);overlay.addEventListener('pointercancel',onPointerUp);overlay.addEventListener('lostpointercapture',onPointerUp);window.addEventListener('blur',()=>finishDrag());
 viewport.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
 viewport.addEventListener('drop',e=>{e.preventDefault();importLayers(Array.from(e.dataTransfer.files).filter(file=>file.type.startsWith('image/')));});
 document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
  if(e.code==='Space'){if(document.activeElement.tagName==='BUTTON')return;e.preventDefault();playToggle();}else if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}else if((e.ctrlKey||e.metaKey)&&e.key==='y'){e.preventDefault();redo();}else if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();downloadJSON();}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected();}else if(e.key===','){stopPlayback();setFrame(currentFrame-1);}else if(e.key==='.'){stopPlayback();setFrame(currentFrame+1);}
 });
 window.addEventListener('resize',()=>{if(project)fitZoom();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)stopPlayback();});
 window.addEventListener('beforeunload',e=>{if(!navigationAllowed&&changeRevision>savedRevision){e.preventDefault();e.returnValue='';}});
}
async function start(){setupUI();try{
 const previous=await B.read('animation-project');if(previous?.layers&&!looksUntouchedDemo(previous)){await loadProject(previous);status(previous.layers.length?'Proyecto recuperado ✓':'Proyecto vacío · importa tus PNG');}
 else{await loadProject(newProject());status('Proyecto nuevo · importa tus PNG');}
 await acceptTransferredArt();
 }catch(e){console.error(e);toast('Error al abrir proyecto: '+e.message,true);await loadProject(newProject());status('No se pudo recuperar · carga tu copia .gmotion.json',true);}
}
// Interface for integration smoke tests; users can also inspect it in the browser's console.
window.GachaMotionApp={undoDepth:()=>undoStack.length,getProject:()=>clone(project),getFrame:()=>currentFrame,setFrame,select:setSelected,createDemo:createDemoProject,loadProject,saveProject:downloadJSON,poseAt,renderScene,exportPNG};
start();
})();
