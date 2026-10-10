import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
const out=fileURLToPath(new URL('./assets',import.meta.url));
const b=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/local/bin/chromium',headless:true,args:['--no-sandbox'],protocolTimeout:300000});const p=await b.newPage();await p.goto('http://localhost:5180');await p.waitForFunction(()=>window.__darkroom);await p.evaluate(()=>window.__darkroom.openSample(0));await new Promise(r=>setTimeout(r,4000));
const result=await p.evaluate(async()=>{const {S}=window.__darkroom,{newDoc,applyTemplate,bestCrop}=await import('/js/templates.js'),{render}=await import('/js/render.js'),{ensureSeg,ensureDepth}=await import('/js/media.js');await ensureSeg(S.doc,S.M);const c=document.createElement('canvas'),files={};function save(n,d){render(c,d,S.M,840,{transient:true});files[n]=c.toDataURL('image/png').split(',')[1]};let d=newDoc(S.project.id);d.film.preset='warm-neg';
for(const tpl of ['magazine','gig','movie','orbit','waveprint'])save(tpl,applyTemplate(tpl,d,S.M.an,S.M.img,{seed:4,caption:'光阴流动 · 留下此刻',keepFilm:true}));
for(const ratio of ['1:1','3:4','16:9']){let dd=structuredClone(d);dd.ratio=ratio;dd.crop=bestCrop(dd,S.M.img,S.M.an,4);save('smart-'+ratio.replace(':','-'),dd)}
let dd=structuredClone(d);dd.layers=[{id:'headline',type:'text',text:'NIGHT',pack:'minimal',size:.24,x:.5,y:.47,color:'#fff9e8',align:'center',line:1,opacity:1,behind:true}];save('behind',dd);dd.layers[0].behind=false;save('front',dd);
if(S.M.seg)files.mask=S.M.seg.toDataURL('image/png').split(',')[1];
let depthError=null;try{await ensureDepth(S.doc,S.M);files.depth=S.M.depth.canvas.toDataURL('image/png').split(',')[1];window.featureDoc=d;}catch(e){depthError=String(e)};
return {files,subject:S.M.an?.subject,depth:!!S.M.depth,seg:!!S.M.seg,depthError};});
for(const[n,data]of Object.entries(result.files))await fs.writeFile(`${out}/${n}.png`,Buffer.from(data,'base64'));delete result.files;console.log(JSON.stringify(result));
if(result.depth){for(let i=0;i<72;i++){const data=await p.evaluate(i=>{const {S}=window.__darkroom;return import('/js/render.js').then(({render})=>{const d=structuredClone(window.featureDoc);d.cam={on:true,x:Math.sin(i/72*Math.PI*2)*.9,y:Math.cos(i/72*Math.PI*2)*.35,zoom:.3,focus:.5};const c=document.createElement('canvas');render(c,d,S.M,720,{transient:true});return c.toDataURL('image/jpeg',.9).split(',')[1]})},i);await fs.writeFile(`${out}/motion-${String(i).padStart(3,'0')}.jpg`,Buffer.from(data,'base64'));}console.log('72 real depth frames captured');}
await fs.writeFile(out+'/feature-evidence.json',JSON.stringify(result,null,2));await b.close();
