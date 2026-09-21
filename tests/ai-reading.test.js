const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {once}=require('node:events');

const root=path.join(__dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function waitFor(check){for(let i=0;i<100;i++){if(await check())return;await sleep(35);}throw new Error('Timed out');}
const jsonHeaders={'Content-Type':'application/json'};

test('AI 配置留在本机、发送前使用指定卡片、返回结构化阅读',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dayloom-ai-test-'));
  const appPort=await freePort(),fakePort=await freePort(),base='http://127.0.0.1:'+appPort;
  let received=[];
  const fake=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));received.push({url:req.url,authorization:req.headers.authorization,body});
    const isTest=body.messages.some(message=>message.content==='Reply with OK only.');
    const content=isTest?'OK':JSON.stringify({title:'两个领域之间的新联系',lead:'这不是原卡片的复述。',insight:'把两条记录放在一起，会出现一个可以继续验证的判断。',connections:[{title:'概念迁移',body:'第一张卡片提供模型，第二张卡片提供应用场景。',sourceIds:['card-a','card-b','not-allowed']}],tension:'关系仍需结合现实经验验证。',action:'记录一次实际应用。',question:'这个关系在哪些情况下不成立？'});
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));
  });
  await new Promise(resolve=>fake.listen(fakePort,'127.0.0.1',resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,DAYLOOM_MODE:'local',PUBLIC_ORIGIN:'',HOST:'127.0.0.1',PORT:String(appPort),WORKTABLE_DATA_DIR:dir},stdio:'ignore'});
  async function request(url,options){return fetch(base+url,{headers:jsonHeaders,...options});}
  try{
    await waitFor(async()=>{try{return (await fetch(base+'/api/me')).ok;}catch{return false;}});
    assert.deepEqual(await request('/api/ai/settings').then(r=>r.json()),{configured:false,baseUrl:'',model:'',hasKey:false});
    const configured=await request('/api/ai/settings',{method:'PUT',body:JSON.stringify({baseUrl:'http://127.0.0.1:'+fakePort+'/v1',model:'local-model',apiKey:'secret-key'})}).then(r=>r.json());
    assert.equal(configured.configured,true);assert.equal(configured.hasKey,true);assert.equal('apiKey' in configured,false);
    assert.equal(JSON.stringify(await request('/api/ai/settings').then(r=>r.json())).includes('secret-key'),false);
    assert.equal((await request('/api/ai/test',{method:'POST',body:'{}'})).status,200);
    const cards=[{id:'card-a',text:'有效前沿关注资产之间的相关性。',tags:['投资'],created:'2026-08-27'},{id:'card-b',text:'产品的重要性质是可复制。',tags:['产品'],created:'2025-12-12'}];
    const digestResponse=await request('/api/ai/digest',{method:'POST',body:JSON.stringify({cards})});
    assert.equal(digestResponse.status,200);
    const result=await digestResponse.json();
    assert.equal(result.digest.title,'两个领域之间的新联系');
    assert.deepEqual(result.digest.connections[0].sourceIds,['card-a','card-b']);
    const generation=received.at(-1);
    assert.equal(generation.url,'/v1/chat/completions');assert.equal(generation.authorization,'Bearer secret-key');
    assert.equal(generation.body.messages[0].content.includes('Dayloom'),false);
    assert.equal(generation.body.messages[0].content.includes('Dayloom'),false);
    assert.equal(generation.body.messages[1].content.includes('有效前沿'),true);
    assert.equal(generation.body.messages[1].content.includes('产品的重要性质'),true);
    assert.equal(generation.body.messages[1].content.includes('secret-key'),false);
    assert.equal((await request('/api/ai/settings',{method:'DELETE',body:'{}'})).status,200);
    assert.equal((await request('/api/ai/settings').then(r=>r.json())).configured,false);
  }finally{
    child.kill();await once(child,'exit');await new Promise(resolve=>fake.close(resolve));
    if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('dayloom-ai-test-'))fs.rmSync(dir,{recursive:true,force:true});
  }
});
