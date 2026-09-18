const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');

function freePort(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function emptyState(){return {version:4,productId:'everyday-worktable',settings:{name:'测试'},tasks:[],knowledge:[],checkins:{},moods:{},notes:{}};}
test('账号隔离、SQLite 持久化 API、版本冲突',async()=>{
  const port=await freePort();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'everyday-worktable-test-'));
  const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',WORKTABLE_DATA_DIR:dir},stdio:'ignore'});
  const base='http://127.0.0.1:'+port;
  const request=async(route,method='GET',body,cookie='')=>{
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    let ready=false;
    for(let i=0;i<60;i++){try{const r=await fetch(base+'/api/me');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.equal(ready,true,'服务器应启动');
    const page=await fetch(base+'/');
    const html=await page.text();
    assert.equal(page.status,200);
    assert.match(html,/日常工作台/);
    assert.doesNotMatch(html,/flomo_seed|diary_seed|Irene/i);
    assert.equal((await fetch(base+'/icon.svg')).status,200);
    assert.equal((await fetch(base+'/manifest.webmanifest')).status,200);
    const a=await request('/api/register','POST',{email:'alice@example.test',password:'long-test-pass-123'});
    assert.equal(a.status,201);
    const b=await request('/api/register','POST',{email:'bob@example.test',password:'long-test-pass-456'});
    assert.equal(b.status,201);
    assert.notEqual(a.cookie,b.cookie);
    assert.equal((await request('/api/state','GET',null,a.cookie)).data.state,null);
    const state=emptyState();state.knowledge.push({id:'note-1',text:'只属于 Alice 的测试笔记',tags:[]});
    const saved=await request('/api/state','PUT',{revision:0,state},a.cookie);
    assert.equal(saved.status,200);assert.equal(saved.data.revision,1);
    assert.equal((await request('/api/state','GET',null,a.cookie)).data.state.knowledge[0].text,state.knowledge[0].text);
    assert.equal((await request('/api/state','GET',null,b.cookie)).data.state,null);
    const conflict=await request('/api/state','PUT',{revision:0,state},a.cookie);
    assert.equal(conflict.status,409);assert.equal(conflict.data.revision,1);
    const wrongProduct=await request('/api/state','PUT',{revision:0,state:{...state,productId:'personal'}},b.cookie);
    assert.equal(wrongProduct.status,400);
    assert.equal((await request('/api/state')).status,401);
    assert.equal((await request('/api/logout','POST',{},a.cookie)).status,200);
    assert.equal((await request('/api/state','GET',null,a.cookie)).status,401);
    assert.equal((await request('/api/state','GET',null,b.cookie)).status,200);
  }finally{
    child.kill();
    await new Promise(resolve=>child.once('exit',resolve));
    if(path.basename(dir).startsWith('everyday-worktable-test-')) fs.rmSync(dir,{recursive:true,force:true});
  }
});
