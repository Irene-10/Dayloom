/* Capture privacy-safe Dayloom screenshots through a running Chrome DevTools port. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');

const endpoint=process.env.CDP_ENDPOINT||'http://127.0.0.1:9223';
const site=process.env.DAYLOOM_URL||'http://127.0.0.1:8791/index.html';
const output=path.join(__dirname,'..','assets');
fs.mkdirSync(output,{recursive:true});

async function connect(){
  const pages=await fetch(endpoint+'/json/list').then(r=>r.json());
  const target=pages.find(p=>p.type==='page');
  if(!target) throw new Error('No Chrome page target found');
  const socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;
  const pending=new Map();
  socket.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.id&&pending.has(msg.id)){
      const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);
      msg.error?reject(new Error(msg.error.message)):resolve(msg.result);
    }
  };
  const call=(method,params={})=>new Promise((resolve,reject)=>{const callId=++id;pending.set(callId,{resolve,reject});socket.send(JSON.stringify({id:callId,method,params}));});
  return {socket,call};
}

const demoState=`(()=>{
  const d=seed(), now=new Date(), today=isoLocal(now), tomorrow=addDaysISO(today,1);
  d.settings.name='Irene';
  d.tasks=[
    {id:'demo1',title:'整理本周的重点计划',project:'work',priority:'high',status:'inprogress',due:today,time:'09:30',completed:false,notes:''},
    {id:'demo2',title:'阅读并整理学习笔记',project:'learning',priority:'medium',status:'backlog',due:today,time:'14:00',completed:false,notes:''},
    {id:'demo3',title:'完成 30 分钟运动',project:'health',priority:'medium',status:'done',due:today,time:'18:30',completed:true,notes:''},
    {id:'demo4',title:'记录一个新的灵感',project:'hobby',priority:'low',status:'backlog',due:tomorrow,time:'',completed:false,notes:''}
  ];
  const patterns=[[1,1,1,1],[1,0,1,1],[1,1,0,1],[0,1,1,0],[1,1,1,1],[1,0,1,0],[1,1,1,1],[0,1,1,1],[1,1,0,0],[1,1,1,0],[1,0,1,1],[1,1,1,1],[1,1,0,1],[1,1,1,0]];
  const moods=['🙂','🤩','😐','🙂','🙂','😕','🤩','🙂','😐','🙂','🤩','🙂','🙂','🙂'];
  patterns.forEach((p,i)=>{const date=addDaysISO(today,i-13);d.checkins[date]={sleep:!!p[0],exercise:!!p[1],reading:!!p[2],study:!!p[3]};d.moods[date]=moods[i];});
  d.notes[today]='今天专注完成最重要的事，也给新的想法留一点空间。';
  const cards=[
    ['稳定的进步来自可持续的小行动，而不是偶尔的高强度投入。',['成长/习惯']],
    ['记录的价值不只是保存答案，也是在为未来留下重新思考的入口。',['知识管理/记录']],
    ['当任务太大时，把下一步缩小到可以立刻开始，行动阻力就会明显下降。',['效率/行动']],
    ['阅读不是收集更多信息，而是让新观点与已有经验发生联系。',['学习/阅读']],
    ['好的系统应该帮助人看见重点，同时允许生活保留弹性。',['产品/设计']]
  ];
  d.knowledge=cards.map((c,i)=>({id:'demo-k'+i,text:c[0],tags:c[1],created:new Date(now.getTime()-i*86400000).toISOString(),favorite:i===0,reviewCount:i}));
  S=d;hydrateDefinitions();save();render();
})()`;

async function main(){
  const {socket,call}=await connect();
  await call('Page.enable');await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:site});
  await new Promise(r=>setTimeout(r,1300));
  await call('Runtime.evaluate',{expression:demoState,awaitPromise:true});
  await new Promise(r=>setTimeout(r,350));

  async function shot(name,expression,width=1440,height=900){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await call('Runtime.evaluate',{expression,awaitPromise:true});
    await new Promise(r=>setTimeout(r,180));
    const result=await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
    fs.writeFileSync(path.join(output,name),Buffer.from(result.data,'base64'));
  }

  await shot('dayloom-dashboard.png',`view='home';S.settings.palette='calm';document.documentElement.dataset.palette='calm';render()`);
  await shot('dayloom-knowledge.png',`view='knowledge';S.settings.palette='calm';document.documentElement.dataset.palette='calm';render()`);
  await shot('dayloom-data.png',`view='statistics';S.settings.palette='calm';document.documentElement.dataset.palette='calm';render()`);
  for(const palette of ['yellow','purple','blue','pink']){
    await shot('theme-'+palette+'.png',`view='home';S.settings.palette='${palette}';document.documentElement.dataset.palette='${palette}';render()`,1120,620);
  }
  socket.close();
}

main().catch(error=>{console.error(error);process.exitCode=1;});
