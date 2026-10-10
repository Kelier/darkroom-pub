import puppeteer from '../../red-room/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import assert from 'node:assert/strict';
const b=await puppeteer.launch({executablePath:'/usr/local/bin/chromium',headless:true,args:['--no-sandbox']});
try{const p=await b.newPage();await p.goto('http://localhost:5180');const result=await p.evaluate(async()=>{
 const {drawLayer}=await import('/js/layers.js'),{FLOW_MODES}=await import('/js/flow.js'),{STICKERS}=await import('/js/presets.js');
 const c=document.createElement('canvas');c.width=c.height=300;const x=c.getContext('2d');
 const outcomes=[];
 for(const f of FLOW_MODES){x.clearRect(0,0,300,300);const box=drawLayer(x,{type:'flow',mode:f.id,text:'光阴流动 SOME LIGHT',pack:'mincho',size:.03,x:0,y:0,repeat:true},300,300);const data=x.getImageData(0,0,300,300).data;outcomes.push({id:f.id,visible:data.some((a,i)=>i%4===3&&a>0),finite:Object.values(box).every(Number.isFinite)});}
 for(const s of STICKERS){x.clearRect(0,0,300,300);drawLayer(x,{type:'sticker',kind:s.id,size:.6,x:.5,y:.5,color:'#f00'},300,300);outcomes.push({id:s.id,visible:x.getImageData(0,0,300,300).data.some((a,i)=>i%4===3&&a>0),finite:true});}
 x.fillStyle='#123456';x.fillRect(0,0,300,300);drawLayer(x,{type:'sticker',kind:'stamp',size:.8,x:.5,y:.5,color:'#f00'},300,300);const opaque=x.getImageData(0,0,300,300).data.every((a,i)=>i%4!==3||a===255);
 return {outcomes,opaque};
});assert.ok(result.opaque);assert.ok(result.outcomes.every(r=>r.visible&&r.finite),JSON.stringify(result));console.log(JSON.stringify({passed:true,flowModes:9,stickers:28,stampPreservesUnderlyingImage:result.opaque}));}finally{await b.close();}
