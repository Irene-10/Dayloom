const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const net=require('node:net');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const root=path.join(__dirname,'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<100;i++){if(await check()) return;await sleep(40);}throw new Error('Timed out');}
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function client(base){
  const memory=new Map();
  const appElement={inert:false};
  const c=vm.createContext({console,fetch:(url,opts)=>fetch(base+url,opts),AbortSignal,setTimeout,clearTimeout,location:{protocol:'http:'},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)},document:{getElementById:()=>appElement,documentElement:{dataset:{}}},render:()=>{},window:{},confirm:()=>true});
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8').split('/* ---------------- date helpers')[0];
  vm.runInContext(fs.readFileSync(path.join(root,'data.js'),'utf8')+'\n'+app+'\nhydrateDefinitions();',c);
  return {run:code=>vm.runInContext(code,c),memory};
}
test('无需登录写入、清除浏览器缓存后恢复、服务重启、中文笔记与离线冲突',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dayloom-local-test-'));
  const port=await freePort(),base='http://127.0.0.1:'+port;
  let child;
  async function start(mode='local'){
    child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,DAYLOOM_MODE:mode,PUBLIC_ORIGIN:'',HOST:'127.0.0.1',PORT:String(port),WORKTABLE_DATA_DIR:dir},stdio:'ignore'});
    await until(async()=>{try{return (await fetch(base+'/api/me')).ok;}catch{return false;}});
  }
  async function stop(){const exited=once(child,'exit');child.kill();await exited;}
  try{
    await start();
    const me=await fetch(base+'/api/me').then(r=>r.json());
    assert.equal(me.mode,'local');assert.equal(me.user.email,'local-device');assert.equal(me.dataPath,path.join(dir,'worktable.sqlite'));
    const a=client(base);
    a.run('S.settings.name="本机测试";S.knowledge=[{id:"k",text:"中文知识卡片",tags:["学习/阅读"]}];S.checkins={"2026-09-20":{reading:true}};S.moods={"2026-09-20":"🙂"};');
    await a.run('initRemoteSync()');
    await until(()=>a.run('remoteSync.revision===1&&!remoteSync.pushing'));
    assert.equal(a.run('remoteSync.status'),'已保存到电脑数据库');
    assert.equal(fs.existsSync(me.dataPath),true);
    await stop();await start();
    const b=client(base); // 全新缓存、没有 cookie，仍读取已保存的数据
    await b.run('initRemoteSync()');
    assert.equal(b.run('S.knowledge[0].text'),'中文知识卡片');
    assert.equal(b.run('S.settings.name'),'本机测试');
    assert.equal(b.run('S.moods["2026-09-20"]'),'🙂');
    b.run('S.settings.name="另一个浏览器";save()');
    await until(()=>b.run('remoteSync.revision===2&&!remoteSync.pushing'));
    a.run('S.knowledge[0].text="旧页面的新修改";save()');
    await until(()=>a.run('remoteSync.conflict'));
    assert.equal(a.run('S.knowledge[0].text'),'旧页面的新修改');
    assert.equal((await fetch(base+'/api/state').then(r=>r.json())).state.settings.name,'另一个浏览器');
    await a.run('resolveSyncConflict(false)');
    assert.equal(a.run('S.settings.name'),'另一个浏览器');
    // 服务中断后的待保存修改，在重新连接时补存，而不是被数据库覆盖。
    a.run('remoteSync.enabled=false;S.settings.name="离线修改";save()');
    await a.run('initRemoteSync()');
    await until(()=>a.run('remoteSync.revision===3&&!remoteSync.pushing'));
    assert.equal((await fetch(base+'/api/state').then(r=>r.json())).state.settings.name,'离线修改');
    // 不同来源不能访问匿名本机数据库。
    assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://attacker.example'}})).status,403);
    const hostStatus=await new Promise((resolve,reject)=>{http.get(base+'/api/state',{headers:{Host:'attacker.example:'+port}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});
    assert.equal(hostStatus,403);
    assert.equal((await fetch(base+'/api/state',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
    assert.equal((await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
    const old=client(base);old.run('S.settings.name="另一个旧版本";S.knowledge=[{id:"old",text:"先保留"}];');
    await old.run('initRemoteSync()');assert.equal(old.run('remoteSync.conflict'),true);assert.equal(old.run('S.knowledge[0].text'),'先保留');
    await stop();await start('accounts');
    assert.equal((await fetch(base+'/api/state')).status,401);
    assert.equal((await fetch(base+'/api/me').then(r=>r.json())).user,null);
  }finally{
    if(child&&child.exitCode===null) await stop();
    // Only remove this test's uniquely allocated temporary directory.
    if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('dayloom-local-test-'))fs.rmSync(dir,{recursive:true,force:true});
  }
});
