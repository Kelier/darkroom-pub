// Local Live / motion-photo workflow. Source clips live in IndexedDB, never uploaded.
import {S,bus,$,el,toast,clone,task,esc} from './state.js';
import {render,clearRenderCache,canvasAspect,baseOf} from './render.js';
import {blobToImage,canvasToBlob,uid,renderBlob} from './media.js';
import {makeZip} from './zip.js';
import {readMotionPhoto,readZip,encodeH264,muxH264,pickEncoder,motionPhotoJpeg,appleLiveJpeg,uuid} from './livefmt.js';
let active=null, playing=false, raf=0, generation=0;
export const isVideo=f=>f.type.startsWith('video/')||/\.(mov|mp4|webm|m4v)$/i.test(f.name);
export const isBundle=f=>/\.(livp|zip)$/i.test(f.name)||/zip/.test(f.type);
export const stem=f=>f.name.replace(/\.[^.]+$/,'').toLowerCase();
export const isMobileUI=()=>matchMedia('(max-width:760px)').matches;
const isApple=()=>/iPhone|iPad|Macintosh/.test(navigator.userAgent)&&!/Android/.test(navigator.userAgent);
export async function videoSource(blob) {
  const v=document.createElement('video'),url=URL.createObjectURL(blob);
  v.muted=true;v.playsInline=true;v.preload='auto';
  const dispose=()=>{v.pause();v.removeAttribute('src');v.load();URL.revokeObjectURL(url);};
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('视频读取超时，请改用 H.264 MP4')),15000);v.onloadeddata=()=>{clearTimeout(timer);resolve();};v.onerror=()=>{clearTimeout(timer);reject(new Error('浏览器无法解码此视频，请导出为 H.264 MP4 后重试'));};v.src=url;});
    if(!Number.isFinite(v.duration)||v.duration<=0)throw new Error('视频时长无效');
    const canvas=document.createElement('canvas');canvas.width=v.videoWidth;canvas.height=v.videoHeight;
    return {v,canvas,dispose};
  } catch(e){dispose();throw e;}
}
export async function seek(source,time) {
  const v=source.v,t=Math.min(Math.max(0,time),Math.max(0,v.duration-.001));
  if(Math.abs(v.currentTime-t)>.001) await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{v.onseeked=null;reject(new Error('无法读取视频帧'));},6000);v.onseeked=()=>{clearTimeout(timer);v.onseeked=null;resolve();};v.currentTime=t;});
  source.canvas.getContext('2d').drawImage(v,0,0,source.canvas.width,source.canvas.height);return source.canvas;
}

// ---------------- import ----------------
// Expands .livp / .zip bundles, pairs same-name stills + clips, and unwraps motion JPEG / HEIC.
// Returns [{ f: File|null, video: Blob|null, keyUs, kind }].
export async function collectLive(files){
  const all=[];
  for(const f of files){ if(isBundle(f)){ try{ all.push(...await readZip(f)); }catch(e){ toast(f.name+'：'+e.message,'err'); } } else all.push(f); }
  const videos=all.filter(isVideo), used=new Set(), list=[];
  for(const f of all.filter(f=>!isVideo(f)&&(f.type.startsWith('image/')||/\.(heic|heif|jpe?g|png|webp)$/i.test(f.name)))){
    const pair=videos.find(v=>!used.has(v)&&stem(v)===stem(f));
    if(pair){used.add(pair);list.push({f,video:pair,kind:'apple'});continue;}
    let mp=null;try{mp=await readMotionPhoto(f);}catch{}
    list.push(mp?{f,video:mp.video,keyUs:mp.keyUs,kind:mp.kind}:{f,video:null});
  }
  videos.filter(v=>!used.has(v)).forEach(v=>list.push({f:null,video:v,kind:'clip'}));
  return list;
}
// Builds the project fields for one import item: { cover, live }.
export async function liveRecord(item){
  const {f,video}=item; let source;
  try{
    let cover=f, img=null;
    if(f){ try{ img=await blobToImage(f); }catch(e){ if(!video) throw new Error(/\.hei[cf]$/i.test(f.name)?'此浏览器无法解码 HEIC，可在相册里选「兼容性最佳」或转为 JPG':'图片无法解码，可转为 JPG 后重试'); cover=null; } }
    if(!video) return {cover,img,live:null};
    source=await videoSource(video);
    const dur=source.v.duration, key=item.keyUs!=null?Math.min(dur,item.keyUs/1e6):item.kind==='apple'?dur/2:0;
    if(!cover){ await seek(source,key); cover=await canvasToBlob(source.canvas,'image/jpeg',.95); img=await blobToImage(cover); }
    return {cover,img,live:{blob:video,name:video.name||'motion.mp4',duration:dur,kind:item.kind||'clip',key,start:0,end:Math.min(dur,15)}};
  } finally { source?.dispose(); }
}

// ---------------- timeline ----------------
export function stopLive(){playing=false;cancelAnimationFrame(raf);active?.v.pause();const b=$('#livePlay');if(b){b.textContent='播放';b.classList.remove('on');}$('#liveBadge')?.classList.remove('playing');}
function settings(){const L=S.project?.live;return S.doc.live||{start:L?.start??0,end:L?.end??Math.min(3,active?.v.duration||3),key:L?.key??0};}
function frameDoc(doc){return {...doc,base:null,cam:{...doc.cam,on:false},optics:{...doc.optics,aperture:0,keepSubject:false},locals:(doc.locals||[]).filter(l=>['radial','gradient'].includes(l.mask.kind))};}
function draw(source,canvas,doc,M,width){source.canvas.getContext('2d').drawImage(source.v,0,0,source.canvas.width,source.canvas.height);clearRenderCache();render(canvas,frameDoc(doc),{...M,img:source.canvas,seg:null,depth:null,plate:null,fg:null},width,{transient:true});}
async function togglePlay(){
  if(playing){stopLive();bus.scheduleRender();return;}
  try{const src=active,cfg=settings();if(!src)return;await seek(src,cfg.start);await src.v.play();playing=true;$('#livePlay').textContent='暂停';$('#livePlay').classList.add('on');$('#liveBadge')?.classList.add('playing');
    const tick=()=>{if(!playing||src!==active)return;if(src.v.currentTime>=cfg.end||src.v.ended){stopLive();bus.scheduleRender();return;}draw(src,$('#view'),S.doc,S.M,Math.min(720,$('#view').width));$('#liveScrub').value=src.v.currentTime;$('#liveTime').textContent=src.v.currentTime.toFixed(1)+'s';raf=requestAnimationFrame(tick);};tick();
  }catch(e){stopLive();toast(e.message,'err');}
}
export async function mountLive(){
  const seq=++generation;stopLive();active?.dispose();active=null;const root=$('#liveTimeline');root.replaceChildren();root.hidden=true;
  let badge=$('#liveBadge');
  if(!badge){badge=el('<button class="live-badge" id="liveBadge" title="播放实况" aria-label="播放实况"><i></i>LIVE</button>');$('#stageInner').append(badge);badge.onclick=()=>togglePlay();}
  badge.hidden=true;$('#editor').classList.toggle('has-live',!!S.project?.live?.blob);
  if(!S.project?.live?.blob)return;
  try{const src=await videoSource(S.project.live.blob);if(seq!==generation){src.dispose();return;}active=src;}catch(e){toast(e.message,'err');return;}
  const cfg=settings(),dur=active.v.duration;root.hidden=false;root.className='live-timeline';badge.hidden=false;
  root.innerHTML=`<div class="lt-row"><button class="btn xs lt-play" id="livePlay">播放</button><input class="scrub" id="liveScrub" aria-label="Live 时间轴" type="range" min="0" max="${dur}" step=".01" value="${cfg.key}"><output id="liveTime">${cfg.key.toFixed(1)}s</output></div><div class="lt-row lt-tools"><label>入点<input id="liveStart" aria-label="片段入点秒数" type="number" inputmode="decimal" min="0" max="${dur}" step=".1" value="${+cfg.start.toFixed(2)}"></label><label>出点<input id="liveEnd" aria-label="片段出点秒数" type="number" inputmode="decimal" min="0" max="${dur}" step=".1" value="${+cfg.end.toFixed(2)}"></label><button class="btn xs" id="liveKey">设为封面</button><button class="btn xs primary" id="liveExport">导出实况</button></div><p class="hint">动态部分保留裁剪、胶卷、文字与贴纸；AI 消除、扩图、主体蒙版和景深只作用于封面静帧。最长 15 秒，无声。</p>`;
  $('#liveScrub').oninput=async e=>{stopLive();const src=active;try{await seek(src,+e.target.value);if(src!==active)return;draw(src,$('#view'),S.doc,S.M,$('#view').width);$('#liveTime').textContent=(+e.target.value).toFixed(1)+'s';}catch(e){toast(e.message,'err');}};
  for(const id of ['liveStart','liveEnd']) $('#'+id).onchange=()=>{
    stopLive();const start=+$('#liveStart').value,end=+$('#liveEnd').value;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>dur+.01||end-start<.1||end-start>15){toast('请选择 0.1–15 秒且在视频时长内的片段','err');$('#liveStart').value=cfg.start;$('#liveEnd').value=cfg.end;return;}
    S.doc.live={...settings(),start,end:Math.min(end,dur)};Object.assign(cfg,S.doc.live);bus.commit('裁剪 Live 片段');
  };
  $('#liveKey').onclick=async()=>{stopLive();const src=active, project=S.project;try{const time=+$('#liveScrub').value;await seek(src,time);const blob=await canvasToBlob(src.canvas,'image/jpeg',.95);if(project!==S.project)return;const id=uid('K');project.assets[id]=blob;S.M.assets.set(id,await blobToImage(blob));S.doc.base=id;S.doc.live={...settings(),key:time};await import('./media.js').then(m=>m.syncBase(S.doc,S.M));bus.commit('设置 Live 封面',{major:true});bus.buildPanel();toast('封面已设为 '+time.toFixed(1)+'s');}catch(e){toast(e.message,'err');}};
  $('#livePlay').onclick=()=>togglePlay();
  $('#liveExport').onclick=()=>exportLive();
}
export async function openLiveImport(){
  if(S.project?.live?.blob){$('#liveTimeline').scrollIntoView({block:'nearest'});toast('在画布下方调整 Live 时间轴');return;}
  const {modal,importFiles}=await import('./batch.js');
  const m=modal(`<h3>导入实况 / 动态照片</h3><p class="sub">普通「导入照片」也会自动识别，这里集中说明支持的来源。</p>
  <ul class="fmt-list"><li><b>安卓动态照片</b><span>Google / 小米 / OPPO / vivo / 三星 / 荣耀等相册的动态 JPG，直接选一张即可</span></li><li><b>iPhone 实况</b><span>同名 HEIC/JPG + MOV 一起选；或 .livp、iCloud 下载的 ZIP 实况包</span></li><li><b>短视频</b><span>MOV / MP4 / WebM，首帧作为封面</span></li></ul>
  <label class="btn primary block">选择文件<input id="liveFiles" type="file" accept="image/*,video/*,.mov,.heic,.heif,.livp,.zip" multiple hidden></label>
  <p class="hint">iPhone 相册直接选图只会给网页静态图。完整实况：在「照片」里点分享 → 选项 → 打开「所有照片数据」→ 存储到「文件」，再从「文件」选择。</p><div class="modal-actions"><button class="btn ghost" data-close>返回</button></div>`);
  $('#liveFiles',m.c).onchange=e=>{const files=[...e.target.files];m.close();importFiles(files);};
}

// ---------------- export ----------------
const download=(blob,name)=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);};
const FORMATS=[
  {id:'apple',name:'iPhone 实况照片',ext:'JPG + MOV',desc:'带 Apple 实况配对标识（同一 Content ID）。iPhone 上用「存储」，Mac 上两个文件一起拖进「照片」。'},
  {id:'motion',name:'安卓动态照片',ext:'单个 .jpg',desc:'Google Motion Photo 标准，Google 相册与小米、OPPO、vivo、三星、荣耀等相册可直接长按播放。'},
  {id:'mp4',name:'视频',ext:'MP4 · H.264',desc:'通用短视频，适合发朋友圈、小红书、抖音。'},
];
let exporting=false, lastFmt=null;
async function renderLive(fmt,long,t){
  const doc=clone(S.doc),M=S.M,blob=S.project.live.blob,name=($('#projName').value||'Live').replace(/[\\/:*?"<>|]/g,'').trim()||'Live';
  const source=await videoSource(blob);
  try{
    const dur=source.v.duration,L=S.project.live,cfg=doc.live||{start:L.start??0,end:L.end??Math.min(3,dur),key:L.key??0};
    const start=Math.max(0,Math.min(cfg.start,dur-.1)),end=Math.min(dur,cfg.end,start+15),len=end-start,fps=len<=6?30:24;
    const aspect=canvasAspect(doc,M.img),w=Math.max(2,Math.round(aspect>=1?long:long*aspect)),c=document.createElement('canvas');
    await seek(source,start);draw(source,c,doc,M,w);
    const out=document.createElement('canvas');out.width=c.width&~1;out.height=c.height&~1;const ox=out.getContext('2d');
    const frames=Math.max(2,Math.round(len*fps));
    const enc=await encodeH264({canvas:out,frames,fps,drawFrame:async i=>{await seek(source,start+i/fps);draw(source,c,doc,M,w);ox.drawImage(c,0,0,out.width,out.height);},onProgress:p=>t.progress(p*.9,`${Math.round(p*frames)} / ${frames} 帧`)});
    const still=Math.max(0,Math.min(len,(cfg.key??start)-start));
    if(fmt==='mp4') return [new File([muxH264(enc)],name+'.mp4',{type:'video/mp4'})];
    t.progress(.94,'封面静帧');
    const sa=canvasAspect(doc,baseOf(doc,M)),sw=Math.round(sa>=1?Math.max(long,2048):Math.max(long,2048)*sa);
    const {blob:cover}=await renderBlob(doc,M,sw,'image/jpeg',.93);
    if(fmt==='motion') return [new File([await motionPhotoJpeg(cover,muxH264(enc),still*1e6)],name+'.MP.jpg',{type:'image/jpeg'})];
    const id=uuid();
    return [new File([await appleLiveJpeg(cover,id)],name+'.JPG',{type:'image/jpeg'}),new File([muxH264(enc,{qt:true,contentId:id,stillTime:still})],name+'.MOV',{type:'video/quicktime'})];
  } finally { source.dispose(); clearRenderCache(); }
}
// Fallback for browsers without WebCodecs: real-time MediaRecorder capture (video only).
async function recordFallback(t){
  const mime=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm'].find(m=>window.MediaRecorder?.isTypeSupported(m));
  if(!mime)throw new Error('当前浏览器不支持视频导出，请换用新版 Chrome 或 Safari');
  const ext=mime.startsWith('video/mp4')?'mp4':'webm',doc=clone(S.doc),M=S.M,name=($('#projName').value||'Live').replace(/[\\/:*?"<>|]/g,'');
  const source=await videoSource(S.project.live.blob);let rec,stream;
  try{
    const L=S.project.live,cfg=doc.live||{start:L.start??0,end:L.end??Math.min(3,source.v.duration),key:0};
    const aspect=canvasAspect(doc,M.img),w=Math.max(2,Math.floor((aspect>=1?720:720*aspect)/2)*2),c=document.createElement('canvas');
    await seek(source,cfg.start);draw(source,c,doc,M,w);stream=c.captureStream(0);const track=stream.getVideoTracks()[0];const chunks=[];
    rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5000000});rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    let recorderError=null;rec.onerror=e=>{recorderError=e.error||new Error('录制失败');};
    const stopped=new Promise(r=>rec.onstop=r);rec.start();
    const frames=Math.max(2,Math.ceil(Math.min(15,cfg.end-cfg.start)*12)),started=performance.now();
    for(let i=0;i<frames;i++){if(recorderError)throw recorderError;await seek(source,cfg.start+i/12);draw(source,c,doc,M,w);track.requestFrame?.();await new Promise(r=>setTimeout(r,Math.max(0,started+(i+1)*1000/12-performance.now())));t.progress((i+1)/frames,`${i+1} / ${frames}`);}
    rec.stop();await stopped;if(recorderError)throw recorderError;
    const movie=new Blob(chunks,{type:mime});if(!movie.size)throw new Error('视频导出为空，请更换浏览器');
    return [new File([movie],name+'.'+ext,{type:mime.split(';')[0]})];
  }finally{if(rec?.state==='recording')rec.stop();stream?.getTracks().forEach(t=>t.stop());source.dispose();clearRenderCache();}
}
// Result sheet: sharing needs a fresh tap (user activation), so it is offered after encoding.
async function deliver(files,fmt){
  const {modal}=await import('./batch.js');
  const size=(files.reduce((s,f)=>s+f.size,0)/1048576).toFixed(1);
  const share=!!navigator.canShare?.({files})&&(isMobileUI()||matchMedia('(pointer:coarse)').matches);
  const tip={apple:'iPhone：点「存储到相册」后在「照片」里显示为实况。Mac：解压后把 JPG 和 MOV 一起拖进「照片」。',motion:'在安卓相册或 Google 相册里打开，长按或点 Motion 播放。',mp4:''}[fmt]||'';
  const m=modal(`<h3>实况已显影</h3><p class="sub">${files.map(f=>esc(f.name)).join(' · ')} · ${size} MB</p>${tip?`<p class="hint">${tip}</p>`:''}<div class="modal-actions stack">${share?'<button class="btn primary" id="lvShare">存储到相册 / 分享</button>':''}<button class="btn ${share?'':'primary'}" id="lvDown">${files.length>1?'下载 ZIP':'下载文件'}</button><button class="btn ghost" data-close>完成</button></div>`);
  if(share)$('#lvShare',m.c).onclick=async()=>{try{await navigator.share({files});m.close();}catch(e){if(e.name!=='AbortError')toast('系统分享不可用，已改为下载','err'),$('#lvDown',m.c).click();}};
  $('#lvDown',m.c).onclick=async()=>{if(files.length>1)download(await makeZip(files.map(f=>({name:f.name,data:f}))),files[0].name.replace(/\.\w+$/,'')+'-live.zip');else download(files[0],files[0].name);m.close();};
}
export async function exportLive(){
  if(exporting)return toast('实况正在导出');
  if(!S.project?.live?.blob)return openLiveImport();
  const {modal,openExportModal}=await import('./batch.js');stopLive();
  const codec=!!(await pickEncoder(720,720,30));
  let fmt=lastFmt||(isApple()?'apple':'motion'),long=1080;if(!codec)fmt='mp4';
  const m=modal(`<h3>导出实况</h3><p class="sub">剪辑片段、封面帧与全部编辑都会带上。按你要存到的相册选择格式。</p>
  <div class="fmt-pick" role="radiogroup">${FORMATS.map(f=>`<button role="radio" class="fmt-opt ${f.id===fmt?'on':''}" data-f="${f.id}" ${!codec&&f.id!=='mp4'?'disabled':''} aria-checked="${f.id===fmt}"><span class="fmt-dot"></span><span class="fmt-t"><b>${f.name}</b><em>${f.ext}</em><small>${f.desc}</small></span></button>`).join('')}</div>
  ${codec?'':'<p class="hint">当前浏览器不支持 WebCodecs H.264 编码，只能导出普通视频。实况格式请用新版 Chrome、Edge 或 Safari 16.4+。</p>'}
  <label class="field">动态清晰度<div class="seg" id="lvRes"><button data-v="720">720p</button><button data-v="1080" class="on">1080p</button></div></label>
  <div class="modal-actions stack"><button class="btn primary" id="lvGo">导出</button><button class="btn" id="lvStill">只导出静态图片</button><button class="btn ghost" data-close>取消</button></div>`);
  m.c.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{fmt=b.dataset.f;m.c.querySelectorAll('[data-f]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-checked',x===b);});});
  m.c.querySelectorAll('#lvRes button').forEach(b=>b.onclick=()=>{long=+b.dataset.v;m.c.querySelectorAll('#lvRes button').forEach(x=>x.classList.toggle('on',x===b));});
  $('#lvStill',m.c).onclick=()=>{m.close();openExportModal({still:true});};
  $('#lvGo',m.c).onclick=async()=>{
    m.close();exporting=true;lastFmt=fmt;const t=task('live-export','正在显影实况');
    try{const files=codec?await renderLive(fmt,long,t):await recordFallback(t);t.done('实况已导出');await deliver(files,fmt);}
    catch(e){console.error(e);t.fail(e.message||'实况导出失败');}
    finally{exporting=false;bus.scheduleRender();}
  };
}
