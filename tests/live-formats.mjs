// Live formats: Apple pair import → export Motion Photo / Apple pair / MP4 → re-import the outputs.
import puppeteer from '../../red-room/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const OUT=process.env.OUT||'/tmp/lvout';fs.mkdirSync(OUT,{recursive:true});
const b=await puppeteer.launch({executablePath:'/usr/local/bin/chromium',headless:true,args:['--no-sandbox']});
const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')console.log('console',m.text().slice(0,250));});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const waitFile=async(re,ms=90000)=>{const t=Date.now();while(Date.now()-t<ms){const f=fs.readdirSync(OUT).find(n=>re.test(n)&&!n.endsWith('.crdownload'));if(f)return OUT+'/'+f;await wait(300);}throw new Error('no file '+re);};
try{
  await p.setViewport({width:1280,height:900});await p.goto('http://localhost:5180');await p.waitForFunction(()=>window.__darkroom);
  const cdp=await p.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:OUT});
  // Build an "iPhone" pair in-page: IMG_0001.JPG + IMG_0001.MOV (H.264 recorded), import both.
  await p.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');
    const paint=i=>{x.fillStyle=`hsl(${i*9},50%,45%)`;x.fillRect(0,0,640,480);x.fillStyle='#fff';x.fillRect(40+i*12,160,90,160);x.font='bold 60px sans-serif';x.fillText(String(i),280,90);};
    const stream=c.captureStream(30),chunks=[],rec=new MediaRecorder(stream,{mimeType:'video/mp4;codecs=avc1.42E01E'});const done=new Promise(r=>rec.onstop=r);rec.ondataavailable=e=>chunks.push(e.data);rec.start();
    for(let i=0;i<36;i++){paint(i);await new Promise(r=>setTimeout(r,60));}rec.stop();await done;stream.getTracks().forEach(t=>t.stop());
    paint(18);const jpg=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));
    const {importFiles}=await import('/js/batch.js');
    await importFiles([new File([jpg],'IMG_0001.JPG',{type:'image/jpeg'}),new File(chunks,'IMG_0001.MOV',{type:'video/quicktime'})]);
  });
  await p.waitForSelector('#liveScrub');
  const L=await p.evaluate(()=>{const l=window.__darkroom.S.project.live;return {kind:l.kind,key:l.key,dur:l.duration};});
  console.log('apple pair imported',L);assert.equal(L.kind,'apple');assert.ok(L.dur>1);
  assert.equal(await p.evaluate(()=>window.__darkroom.S.tray.length>0),true);
  await p.evaluate(()=>window.__darkroom.bus.loadFilm('warm-neg'));await wait(400);
  for(const [fmt,re] of [['motion',/\.MP\.jpg$/],['apple',/-live\.zip$/],['mp4',/^IMG_0001\.mp4$/]]){
    await p.click('#exportBtn');await p.waitForSelector(`[data-f="${fmt}"]`,{visible:true});await p.click(`[data-f="${fmt}"]`);await p.click('#lvGo');
    const iv=setInterval(async()=>console.log('  task:',await p.evaluate(()=>[...document.querySelectorAll('#tasks .task')].map(t=>t.textContent).join('|')+' modal:'+document.querySelector('#modal').hidden)),5000);await p.waitForSelector('#lvDown',{visible:true,timeout:240000}).finally(()=>clearInterval(iv));await p.click('#lvDown');const f=await waitFile(re);console.log(fmt,'→',f,fs.statSync(f).size);
  }
  // Round trip: exported Motion Photo must import back as a live project.
  const mp=fs.readFileSync(fs.readdirSync(OUT).map(n=>OUT+'/'+n).find(n=>n.endsWith('.MP.jpg')));
  const back=await p.evaluate(async(arr)=>{const {readMotionPhoto}=await import('/js/livefmt.js');const r=await readMotionPhoto(new File([new Uint8Array(arr)],'x.MP.jpg',{type:'image/jpeg'}));return r&&{kind:r.kind,keyUs:r.keyUs,size:r.video.size};},[...mp]);
  console.log('motion re-read',back);assert.equal(back.kind,'google');
  // Bundle import: the Apple zip goes back in as one live project.
  const zip=fs.readFileSync(fs.readdirSync(OUT).map(n=>OUT+'/'+n).find(n=>n.endsWith('-live.zip')));
  const kinds=await p.evaluate(async(arr)=>{const {collectLive}=await import('/js/live.js');const l=await collectLive([new File([new Uint8Array(arr)],'IMG_0001.livp')]);return l.map(i=>i.kind);},[...zip]);
  console.log('livp bundle',kinds);assert.deepEqual(kinds,['apple']);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true}));
}finally{await b.close();}
