/* Same-origin static site + per-account SQLite sync. Run behind HTTPS in production. */
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const os=require('node:os');
const {DatabaseSync}=require('node:sqlite');

const ROOT=__dirname;
const USER_DATA_ROOT=process.env.LOCALAPPDATA||process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share');
const DATA_DIR=path.resolve(process.env.WORKTABLE_DATA_DIR||path.join(USER_DATA_ROOT,'EverydayWorktable'));
const PORT=Number(process.env.PORT||8787);
const HOST=process.env.HOST||'127.0.0.1';
const PUBLIC_ORIGIN=process.env.PUBLIC_ORIGIN||'';
const MAX_BODY=10*1024*1024;
fs.mkdirSync(DATA_DIR,{recursive:true,mode:0o700});
const db=new DatabaseSync(path.join(DATA_DIR,'worktable.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS states(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,revision INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL);`);

const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/data.js':'data.js','/boot.js':'boot.js','/palette-themes.css':'palette-themes.css','/enhancements.css':'enhancements.css','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg','/sw.js':'sw.js'};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json; charset=utf-8'};
const attempts=new Map();
function json(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));}
function sessionUser(req){
  const token=cookies(req).worktable_session;
  if(!token||! /^[a-f0-9]{64}$/.test(token)) return null;
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  return db.prepare('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').get(hash,Date.now())||null;
}
function setCookie(res,token){
  const secure=PUBLIC_ORIGIN.startsWith('https://')?'; Secure':'';
  res.setHeader('Set-Cookie','worktable_session='+token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000'+secure);
}
function clearCookie(res){res.setHeader('Set-Cookie','worktable_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');}
function readBody(req){return new Promise((resolve,reject)=>{
  let size=0,chunks=[];
  req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){reject(Object.assign(new Error('请求过大'),{status:413}));req.destroy();return;}chunks.push(chunk);});
  req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Object.assign(new Error('无效 JSON'),{status:400}));}});
  req.on('error',reject);
});}
function limited(req){
  const ip=req.socket.remoteAddress||'unknown',now=Date.now();
  const recent=(attempts.get(ip)||[]).filter(t=>now-t<15*60*1000);
  recent.push(now);attempts.set(ip,recent);
  return recent.length>30;
}
function passwordHash(password,salt){return crypto.scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');}
function issueSession(res,userId){
  const token=crypto.randomBytes(32).toString('hex');
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash,userId,Date.now()+30*86400000);
  setCookie(res,token);
}
function validState(state){return state&&state.version===4&&state.productId==='everyday-worktable'&&Array.isArray(state.tasks)&&Array.isArray(state.knowledge)&&state.settings&&typeof state.settings==='object'&&state.checkins&&typeof state.checkins==='object';}
function originAllowed(req){
  const origin=req.headers.origin;
  if(!origin) return true;
  const host=req.headers.host;
  return origin==='http://'+host||origin==='https://'+host||(PUBLIC_ORIGIN&&origin===PUBLIC_ORIGIN);
}
async function api(req,res,url){
  if(req.method!=='GET'&&!originAllowed(req)) return json(res,403,{error:'请求来源不被允许'});
  if(url.pathname==='/api/me'&&req.method==='GET'){
    const user=sessionUser(req);return json(res,200,{user:user?{email:user.email}:null});
  }
  if((url.pathname==='/api/register'||url.pathname==='/api/login')&&req.method==='POST'){
    if(limited(req)) return json(res,429,{error:'尝试次数过多，请稍后再试'});
    const body=await readBody(req), email=String(body.email||'').trim().toLowerCase(), password=String(body.password||'');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254) return json(res,400,{error:'请输入有效邮箱'});
    if(url.pathname==='/api/register'){
      if(password.length<12||password.length>256) return json(res,400,{error:'密码需要 12–256 个字符'});
      if(db.prepare('SELECT id FROM users WHERE email=?').get(email)) return json(res,409,{error:'该邮箱已注册'});
      const salt=crypto.randomBytes(16).toString('hex');
      const result=db.prepare('INSERT INTO users(email,salt,password_hash,created_at) VALUES(?,?,?,?)').run(email,salt,passwordHash(password,salt),Date.now());
      issueSession(res,Number(result.lastInsertRowid));return json(res,201,{user:{email}});
    }
    const user=db.prepare('SELECT id,salt,password_hash FROM users WHERE email=?').get(email);
    const actual=passwordHash(password,user?user.salt:'00000000000000000000000000000000');
    const expected=Buffer.from(user?user.password_hash:'0'.repeat(128),'hex');
    if(!crypto.timingSafeEqual(Buffer.from(actual,'hex'),expected)||!user) return json(res,401,{error:'邮箱或密码不正确'});
    issueSession(res,user.id);return json(res,200,{user:{email}});
  }
  if(url.pathname==='/api/logout'&&req.method==='POST'){
    const token=cookies(req).worktable_session;
    if(token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
    clearCookie(res);return json(res,200,{ok:true});
  }
  const user=sessionUser(req);
  if(!user) return json(res,401,{error:'请先登录'});
  if(url.pathname==='/api/state'&&req.method==='GET'){
    const row=db.prepare('SELECT revision,data,updated_at FROM states WHERE user_id=?').get(user.id);
    return json(res,200,{revision:row?row.revision:0,state:row?JSON.parse(row.data):null,updatedAt:row?row.updated_at:null});
  }
  if(url.pathname==='/api/state'&&req.method==='PUT'){
    const body=await readBody(req);
    if(!Number.isInteger(body.revision)||body.revision<0||!validState(body.state)) return json(res,400,{error:'数据格式无效'});
    const state=JSON.stringify(body.state);
    if(Buffer.byteLength(state)>MAX_BODY) return json(res,413,{error:'数据超过 10 MB 上限，请先导出备份'});
    let result;
    db.exec('BEGIN IMMEDIATE');
    try{
      const row=db.prepare('SELECT revision FROM states WHERE user_id=?').get(user.id);
      const current=row?row.revision:0;
      if(current!==body.revision) result={conflict:true,revision:current};
      else if(row){db.prepare('UPDATE states SET revision=?,data=?,updated_at=? WHERE user_id=?').run(current+1,state,Date.now(),user.id);result={revision:current+1};}
      else {db.prepare('INSERT INTO states(user_id,revision,data,updated_at) VALUES(?,?,?,?)').run(user.id,1,state,Date.now());result={revision:1};}
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,result.conflict?409:200,result);
  }
  return json(res,404,{error:'接口不存在'});
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try{
    const url=new URL(req.url,'http://local');
    if(url.pathname.startsWith('/api/')) return await api(req,res,url);
    const name=files[url.pathname];
    if(!name||req.method!=='GET') return json(res,404,{error:'未找到页面'});
    const file=path.join(ROOT,name);
    const stat=fs.statSync(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':name==='index.html'?'no-cache':'public, max-age=300'});
    fs.createReadStream(file).pipe(res);
  }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'服务器错误'});else res.end();}
});
server.listen(PORT,HOST,()=>console.log('Dayloom: http://'+HOST+':'+PORT));
