const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const vm=require('node:vm');
const {spawn}=require('node:child_process');

function freePort(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function emptyState(){return {version:4,productId:'everyday-worktable',settings:{name:'测试'},tasks:[],knowledge:[],checkins:{},moods:{},notes:{}};}
test('公开版默认项目与打卡、空白数据',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','data.js'),'utf8');
  const state=vm.runInNewContext(source+'\n({projects:PROJECT_DEFAULTS.map(p=>p.name),habits:HABIT_DEFAULTS.map(c=>c.l),seed:seed()})');
  assert.deepEqual([...state.projects],['工作事业','长期学习','运动健康','兴趣爱好','日常生活','副业探索']);
  assert.deepEqual([...state.habits],['早睡','运动','阅读','学习']);
  assert.equal(vm.runInNewContext(source+'\nHABIT_DEFAULTS.find(c=>c.k==="study").icon'),'brain');
  assert.equal(state.seed.tasks.length,0);assert.equal(state.seed.knowledge.length,0);
});
test('旧版喝水记录保留原义，新打卡使用独立键',()=>{
  const data=fs.readFileSync(path.join(__dirname,'..','data.js'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const migrate=app.match(/function hydrateDefinitions\(\)\{[\s\S]*?^\}/m)?.[0];
  assert.ok(migrate);
  const result=vm.runInNewContext(data+'\n'+migrate+'\nlet S={checkins:{"2026-09-18":{water:true}}};let projFilter="all";function todayISO(){return "2026-09-19";}hydrateDefinitions();({active:CHECKIN_DEFS.map(c=>c.k),old:S.habits.find(c=>c.k==="water")})');
  assert.ok([...result.active].includes('study'));
  assert.equal(result.old.l,'喝水');
  assert.equal(result.old.archivedAt,'2026-09-20');
});
test('旧版记录打卡隐藏但历史保留，学习图标与阅读区分',()=>{
  const data=fs.readFileSync(path.join(__dirname,'..','data.js'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const migrate=app.match(/function hydrateDefinitions\(\)\{[\s\S]*?^\}/m)?.[0];
  assert.ok(migrate);
  const result=vm.runInNewContext(data+'\n'+migrate+'\nlet S={projects:PROJECT_DEFAULTS.map(p=>({...p})),habits:[...HABIT_DEFAULTS.map(c=>({...c})),{k:"journal",l:"记录",icon:"book",emoji:"📝",color:"#4e8290",createdAt:null,archivedAt:null}],checkins:{"2026-09-18":{journal:true}}};S.habits.find(c=>c.k==="study").icon="book";let projFilter="all";function todayISO(){return "2026-09-19";}hydrateDefinitions();({active:CHECKIN_DEFS.map(c=>c.k),journal:S.habits.find(c=>c.k==="journal"),study:S.habits.find(c=>c.k==="study"),historic:S.checkins["2026-09-18"].journal})');
  assert.deepEqual([...result.active],['sleep','exercise','reading','study']);
  assert.equal(result.journal.archivedAt,'2026-09-19');
  assert.equal(result.study.icon,'brain');
  assert.equal(result.historic,true);
});
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
    state.projects=[{key:'work',name:'自定义工作',color:'#376b91'}];
    state.habits=[{k:'reading',l:'阅读',color:'#a65e83',emoji:'📖',createdAt:null,archivedAt:null}];
    state.checkins['2026-09-18']={reading:true};state.moods['2026-09-18']='🙂';
    const saved=await request('/api/state','PUT',{revision:0,state},a.cookie);
    assert.equal(saved.status,200);assert.equal(saved.data.revision,1);
    assert.equal((await request('/api/state','GET',null,a.cookie)).data.state.knowledge[0].text,state.knowledge[0].text);
    const restored=(await request('/api/state','GET',null,a.cookie)).data.state;
    assert.equal(restored.projects[0].name,'自定义工作');
    assert.equal(restored.habits[0].l,'阅读');
    assert.equal(restored.checkins['2026-09-18'].reading,true);
    assert.equal(restored.moods['2026-09-18'],'🙂');
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
