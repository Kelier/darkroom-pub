import puppeteer from '../../red-room/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import assert from 'node:assert/strict';
const b=await puppeteer.launch({executablePath:'/usr/local/bin/chromium',headless:true,args:['--no-sandbox']});
const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')console.log('console',m.text().slice(0,250));});
try{
await p.setViewport({width:1440,height:1050});await p.goto('http://localhost:5180');await p.waitForFunction(()=>window.__darkroom);await p.evaluate(()=>window.__darkroom.openSample(0));await new Promise(r=>setTimeout(r,3500));
console.log('loaded');
await p.click('[data-stock="warm-neg"]');
assert.equal(await p.evaluate(()=>window.__darkroom.S.doc.film.preset),'warm-neg');
await p.evaluate(()=>{window.__darkroom.S.doc.film.adjust={exposure:1};window.__darkroom.S.doc.film.curves={rgb:[[0,1],[1,0]]};});await p.click('[data-stock="none"]');assert.deepEqual(await p.evaluate(()=>window.__darkroom.S.doc.film.adjust),{});
await p.evaluate(()=>window.__darkroom.setTool('text'));
await p.click('[data-flow="wave"]');assert.equal(await p.evaluate(()=>window.__darkroom.S.doc.layers.at(-1).mode),'wave');
await p.evaluate(()=>window.__darkroom.setTool('layout'));
await p.click('[data-t="book"]');const one=await p.evaluate(()=>JSON.stringify(window.__darkroom.S.doc));await p.click('#rollLay2');const two=await p.evaluate(()=>JSON.stringify(window.__darkroom.S.doc));assert.notEqual(one,two);
await p.evaluate(()=>window.__darkroom.setTool('layout'));const input=await p.$('#stickerInput');await input.uploadFile('/workspace/oiioii-canvas/photo-studio/assets/samples/map.jpg');await p.waitForFunction(()=>window.__darkroom.S.doc.layers.some(l=>l.kind==='custom'));
console.log('stickers/template passed');
await p.click('#saveBtn');await new Promise(r=>setTimeout(r,500));const id=await p.evaluate(()=>window.__darkroom.S.project.id);await p.evaluate(id=>window.__darkroom.bus.openById(id),id);assert.ok(await p.evaluate(()=>window.__darkroom.S.doc.layers.some(l=>l.kind==='custom')));
await p.click('#resetOriginal');await p.waitForFunction(()=>window.__darkroom.S.doc.layers.length===0);assert.equal(await p.evaluate(()=>window.__darkroom.S.doc.ratio),'orig');await p.click('#undoBtn');await p.waitForFunction(()=>window.__darkroom.S.doc.layers.some(l=>l.kind==='custom'));
await p.evaluate(()=>window.__darkroom.setTool('color'));await new Promise(r=>setTimeout(r,2000));await p.screenshot({path:'/workspace/oiioii-canvas/photo-studio/docs/darkroom-desktop.png'});
await p.click('#darkenBtn');await new Promise(r=>setTimeout(r,500));await p.screenshot({path:'/workspace/oiioii-canvas/photo-studio/docs/darkroom-lights-out.png'});await p.click('#darkenBtn');
// Generate an actual video fixture in browser; then run public import, persistence, trim and export controls.
await p.evaluate(async()=>{
 const c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d'),stream=c.captureStream(12),chunks=[],rec=new MediaRecorder(stream,{mimeType:'video/webm'});const done=new Promise(r=>rec.onstop=r);rec.ondataavailable=e=>chunks.push(e.data);rec.start();for(let i=0;i<18;i++){x.fillStyle=i%2?'#d3b276':'#526c63';x.fillRect(0,0,320,240);x.fillStyle='#eee';x.fillRect(i*12,70,40,80);await new Promise(r=>setTimeout(r,90));}rec.stop();await done;stream.getTracks().forEach(t=>t.stop());
 const {importFiles}=await import('/js/batch.js');await importFiles([new File(chunks,'test-live.webm',{type:'video/webm'})]);
});
await p.waitForSelector('#liveScrub');console.log('Live imported');await p.$eval('#liveScrub',e=>{e.value=.5;e.dispatchEvent(new Event('input',{bubbles:true}));});await new Promise(r=>setTimeout(r,500));await p.click('#liveKey');await p.waitForFunction(()=>!!window.__darkroom.S.doc.base);await p.click('#saveBtn');await new Promise(r=>setTimeout(r,400));const liveId=await p.evaluate(()=>window.__darkroom.S.project.id);await p.evaluate(id=>window.__darkroom.bus.openById(id),liveId);await p.waitForSelector('#liveScrub');assert.ok(await p.evaluate(()=>window.__darkroom.S.project.live.blob.size>0));
await p.click('#livePlay');await new Promise(r=>setTimeout(r,500));await p.click('#livePlay');
const client=await p.createCDPSession();await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:'/workspace/oiioii-canvas/photo-studio/docs'});
await p.click('#liveExport');await p.waitForSelector('#livePackage',{visible:true});await p.click('#livePackage');await p.waitForFunction(()=>[...document.querySelectorAll('#tasks b')].some(e=>e.textContent==='动态照片已导出'),{timeout:60000});console.log('Live export passed');
await p.setViewport({width:390,height:844});await p.evaluate(()=>window.__darkroom.setTool('text'));await new Promise(r=>setTimeout(r,800));await p.screenshot({path:'/workspace/oiioii-canvas/photo-studio/docs/darkroom-mobile.png'});
assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,errors}));
}finally{await b.close();}
