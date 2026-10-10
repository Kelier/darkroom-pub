// Local motion-photo workflow. Source clips live in IndexedDB, never uploaded.
import {S,bus,$,el,toast,clone,task} from './state.js';
import {render,clearRenderCache,canvasAspect} from './render.js';
import {blobToImage,canvasToBlob,uid} from './media.js';
import {makeZip} from './zip.js';
let active=null, playing=false, raf=0, generation=0;
export const isVideo=f=>f.type.startsWith('video/')||/\.(mov|mp4|webm|m4v)$/i.test(f.name);
export const stem=f=>f.name.replace(/\.[^.]+$/,'').toLowerCase();
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
// Google/Samsung JPEG motion photos contain an appended ISO-BMFF video.
export async function embeddedMotion(file) {
  if(!/image\/jpeg/.test(file.type)&&! /\.jpe?g$/i.test(file.name))return null;
  const bytes=new Uint8Array(await file.arrayBuffer());
  for(let i=4;i<bytes.length-12;i++) if(bytes[i]===102&&bytes[i+1]===116&&bytes[i+2]===121&&bytes[i+3]===112){
    const start=i-4,size=new DataView(bytes.buffer).getUint32(start);
    if(size>=16&&size<256&&start>100) return new Blob([bytes.subarray(start)],{type:'video/mp4'});
  }return null;
}
export function stopLive(){playing=false;cancelAnimationFrame(raf);active?.v.pause();const b=$('#livePlay');if(b)b.textContent='播放';}
function settings(){return S.doc.live||{start:0,end:Math.min(3,active?.v.duration||3),key:0};}
function frameDoc(doc){return {...doc,base:null,cam:{...doc.cam,on:false},optics:{...doc.optics,aperture:0,keepSubject:false},locals:(doc.locals||[]).filter(l=>['radial','gradient'].includes(l.mask.kind))};}
function draw(source,canvas,doc,M,width){source.canvas.getContext('2d').drawImage(source.v,0,0,source.canvas.width,source.canvas.height);clearRenderCache();render(canvas,frameDoc(doc),{...M,img:source.canvas,seg:null,depth:null,plate:null,fg:null},width,{transient:true});}
export async function mountLive(){
  const seq=++generation;stopLive();active?.dispose();active=null;const root=$('#liveTimeline');root.replaceChildren();root.hidden=true;
  if(!S.project?.live?.blob)return;
  try{const src=await videoSource(S.project.live.blob);if(seq!==generation){src.dispose();return;}active=src;}catch(e){toast(e.message,'err');return;}
  const cfg=settings(),dur=active.v.duration;root.hidden=false;root.className='live-timeline';
  root.innerHTML=`<button class="btn xs" id="livePlay">播放</button><input class="scrub" id="liveScrub" aria-label="Live 时间轴" type="range" min="0" max="${dur}" step=".01" value="${cfg.key}"><output id="liveTime">${cfg.key.toFixed(2)}s</output><label>入点<input id="liveStart" aria-label="片段入点秒数" type="number" min="0" max="${dur}" step=".1" value="${cfg.start}"></label><label>出点<input id="liveEnd" aria-label="片段出点秒数" type="number" min="0" max="${dur}" step=".1" value="${cfg.end}"></label><button class="btn xs" id="liveKey">设为封面</button><button class="btn xs" id="liveExport">导出动态</button><p class="hint">动态沿用裁剪、胶卷、文字与贴纸；AI 消除、扩图、主体蒙版和景深仅用于静态封面。最长导出 15 秒，无声。</p>`;
  $('#liveScrub').oninput=async e=>{stopLive();const src=active;try{await seek(src,+e.target.value);if(src!==active)return;draw(src,$('#view'),S.doc,S.M,$('#view').width);$('#liveTime').textContent=(+e.target.value).toFixed(2)+'s';}catch(e){toast(e.message,'err');}};
  for(const id of ['liveStart','liveEnd']) $('#'+id).onchange=()=>{
    stopLive();const start=+$('#liveStart').value,end=+$('#liveEnd').value;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>dur||end-start<.1||end-start>15){toast('请选择 0.1–15 秒且在视频时长内的片段','err');$('#liveStart').value=cfg.start;$('#liveEnd').value=cfg.end;return;}
    S.doc.live={...settings(),start,end};Object.assign(cfg,S.doc.live);bus.commit('裁剪 Live 片段');
  };
  $('#liveKey').onclick=async()=>{stopLive();const src=active, project=S.project;try{const time=+$('#liveScrub').value;await seek(src,time);const blob=await canvasToBlob(src.canvas,'image/jpeg',.95);if(project!==S.project)return;const id=uid('K');project.assets[id]=blob;S.M.assets.set(id,await blobToImage(blob));S.doc.base=id;S.doc.live={...settings(),key:time};await import('./media.js').then(m=>m.syncBase(S.doc,S.M));bus.commit('设置 Live 封面',{major:true});bus.buildPanel();}catch(e){toast(e.message,'err');}};
  $('#livePlay').onclick=async()=>{if(playing){stopLive();bus.scheduleRender();return;}try{const src=active,cfg=settings();await seek(src,cfg.start);await src.v.play();playing=true;$('#livePlay').textContent='暂停';const tick=()=>{if(!playing||src!==active)return;if(src.v.currentTime>=cfg.end||src.v.ended){stopLive();bus.scheduleRender();return;}draw(src,$('#view'),S.doc,S.M,Math.min(640,$('#view').width));$('#liveScrub').value=src.v.currentTime;$('#liveTime').textContent=src.v.currentTime.toFixed(2)+'s';raf=requestAnimationFrame(tick);};tick();}catch(e){stopLive();toast(e.message,'err');}};
  $('#liveExport').onclick=()=>exportLive();
}
export async function openLiveImport(){
  if(S.project?.live?.blob){$('#liveTimeline').scrollIntoView({block:'nearest'});toast('在画布下方调整 Live 时间轴');return;}
  const {modal,importFiles}=await import('./batch.js');
  const m=modal(`<h3>把瞬间带进暗房</h3><p class="sub">同时选择同名的照片和 MOV / MP4，可配成一张 Live；也支持安卓内嵌视频的动态 JPG、单独短视频。</p><label class="btn primary block">选择 Live 文件<input id="liveFiles" type="file" accept="image/*,video/*,.mov,.heic,.heif" multiple hidden></label><p class="hint">iPhone 请导出未修改的原片和配套视频。HEIC / HEVC 能否读取取决于浏览器，可改用 JPG + H.264 MP4。动态导出为视频或 JPG + 视频包，暂不生成苹果相册识别的原生 Live Photo。</p><div class="modal-actions"><button class="btn ghost" data-close>返回</button></div>`);
  $('#liveFiles',m.c).onchange=e=>{const files=[...e.target.files];m.close();importFiles(files);};
}
const download=(blob,name)=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);};
let exporting=false;
export async function exportLive(){
  if(exporting)return toast('动态文件正在导出');
  if(!S.project?.live?.blob)return openLiveImport();
  const {modal}=await import('./batch.js');
  const mime=['video/mp4;codecs=avc1.42E01E','video/webm;codecs=vp9','video/webm;codecs=vp8'].find(m=>window.MediaRecorder?.isTypeSupported(m));
  if(!mime)return toast('当前浏览器不支持视频导出，请换用 Chrome 或 Safari','err');
  const ext=mime.startsWith('video/mp4')?'mp4':'webm';
  const m=modal(`<h3>导出动态照片</h3><p class="sub">720 px 动态短片 · ${ext.toUpperCase()} · 无声。保留裁剪、调色、文字、贴纸和画布。照片包包含 JPG 封面、视频及编辑参数。</p><p class="hint">照片包不是苹果原生 Live Photo；iPhone 相册不会自动将它识别为实况照片。</p><div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn" id="liveMovie">仅视频</button><button class="btn primary" id="livePackage">照片 + 视频包</button></div>`);
  const run=async pack=>{
    exporting=true;stopLive();m.close();const doc=clone(S.doc),M=S.M,blob=S.project.live.blob,name=($('#projName').value||'Live').replace(/[\\/:*?"<>|]/g,'');
    const t=task('live-export','正在显影动态照片');let source,rec,stream;
    try{
      source=await videoSource(blob);const cfg=doc.live||{start:0,end:Math.min(3,source.v.duration),key:0};
      const aspect=canvasAspect(doc,M.img),w=Math.max(2,Math.floor((aspect>=1?720:720*aspect)/2)*2),c=document.createElement('canvas');
      await seek(source,cfg.start);draw(source,c,doc,M,w);stream=c.captureStream(0);const track=stream.getVideoTracks()[0];const chunks=[];
      rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5000000});rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      let recorderError=null;rec.onerror=e=>{recorderError=e.error||new Error('录制失败');};
      const stopped=new Promise(r=>rec.onstop=r);rec.start();
      const frames=Math.max(2,Math.ceil(Math.min(15,cfg.end-cfg.start)*12)), started=performance.now();
      for(let i=0;i<frames;i++){if(recorderError)throw recorderError;await seek(source,cfg.start+i/12);draw(source,c,doc,M,w);track.requestFrame?.();await new Promise(r=>setTimeout(r,Math.max(0,started+(i+1)*1000/12-performance.now())));t.progress((i+1)/frames,`${i+1} / ${frames}`);}
      rec.stop();await stopped;if(recorderError)throw recorderError;
      const movie=new Blob(chunks,{type:mime});if(!movie.size)throw new Error('视频导出为空，请更换浏览器');
      if(pack){await seek(source,cfg.key);draw(source,c,doc,M,w);const cover=await canvasToBlob(c,'image/jpeg',.95);
        download(await makeZip([{name:name+'.jpg',data:cover},{name:name+'.'+ext,data:movie},{name:'darkroom-edit.json',data:new Blob([JSON.stringify({format:'darkroom-motion-v1',nativeAppleLivePhoto:false,muted:true,doc},null,2)])}]),name+'-motion.zip');
      }else download(movie,name+'.'+ext);
      t.done('动态照片已导出');
    }catch(e){t.fail(e.message||'动态导出失败');}
    finally{if(rec?.state==='recording')rec.stop();stream?.getTracks().forEach(t=>t.stop());source?.dispose();clearRenderCache();bus.scheduleRender();exporting=false;}
  };
  $('#liveMovie',m.c).onclick=()=>run(false);$('#livePackage',m.c).onclick=()=>run(true);
}
