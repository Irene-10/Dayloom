/* ============================================================
   Dayloom — application logic (classic script)
   Depends on data.js (globals: PROJECTS, NAV, ICONS, ic, seed, helpers)
   任务管理 + 打卡记录 + 知识库
   ============================================================ */

const DB_KEY = 'everyday_worktable_public_v1';
const SYNC_DIRTY_KEY='everyday_worktable_sync_dirty_v1';
let S = load() || seed();
let remoteSync={mode:'browser',dataPath:'',available:false,user:null,enabled:false,revision:0,pushing:false,dirty:false,hydrating:false,ready:false,conflict:false,status:'正在连接数据存储…',timer:null};
let aiService={available:false,configured:false,baseUrl:'',model:'',hasKey:false,generating:false,error:''};
let pendingAiCards=[];
let digestShuffle=0;
let view = 'home';
let viewArg = null;          // detail id
let qaOpen = false;          // quick-add menu
let calCursor = new Date(todayMid());
let calMode = 'month';       // month | week
let checkinMonthCursor = new Date(todayMid());
let projFilter = 'all';      // 项目看板筛选
function hydrateDefinitions(){
  if(!Array.isArray(S.projects)) S.projects=PROJECT_DEFAULTS.map(p=>({...p}));
  if(!Array.isArray(S.habits)){
    const oldKeys=['water','focus'];
    const oldNames={water:'喝水',focus:'专注'};
    const preserved=oldKeys.filter(k=>Object.values(S.checkins||{}).some(rec=>rec&&rec[k])).map(k=>({k,l:oldNames[k],icon:k==='water'?'globe':'target',emoji:k==='water'?'💧':'🎯',color:'#788b91',createdAt:null,archivedAt:addDaysISO(todayISO(),1)}));
    S.habits=[...HABIT_DEFAULTS.map(c=>({...c})),...preserved];
  }
  S.projects=S.projects.filter(p=>p&&typeof p.key==='string'&&p.key&&typeof p.name==='string');
  if(!S.projects.length) S.projects=PROJECT_DEFAULTS.map(p=>({...p}));
  S.habits=S.habits.filter(c=>c&&typeof c.k==='string'&&c.k&&typeof c.l==='string');
  S.habits.forEach(c=>{
    if(c.k==='study'&&c.l==='学习'&&c.icon==='book') c.icon='brain';
    if(c.k==='journal'&&c.l==='记录'&&!c.archivedAt) c.archivedAt=todayISO();
  });
  S.projects.forEach(p=>{if(!/^#[0-9a-fA-F]{6}$/.test(p.color||''))p.color='#4e8290';if(!p.short)p.short=p.name.slice(0,4);if(!p.icon)p.icon='target';});
  S.habits.forEach(c=>{if(!/^#[0-9a-fA-F]{6}$/.test(c.color||''))c.color='#4e8290';if(!c.icon)c.icon='check';});
  S.habits.forEach(c=>{if(!c.emoji)c.emoji=HABIT_DEFAULTS.find(x=>x.k===c.k)?.emoji||'✨';});
  PROJ_ORDER.splice(0,PROJ_ORDER.length,...S.projects.map(p=>p.key));
  Object.keys(PROJECTS).forEach(k=>delete PROJECTS[k]);
  S.projects.forEach(p=>PROJECTS[p.key]=p);
  CHECKIN_DEFS.splice(0,CHECKIN_DEFS.length,...S.habits.filter(c=>!c.archivedAt));
  if(projFilter!=='all'&&!PROJECTS[projFilter]) projFilter='all';
}
function habitAt(c,date){return (!c.createdAt||date>=c.createdAt)&&(!c.archivedAt||date<c.archivedAt);}
function habitStyle(c){return '--habit-color:'+(/^#[0-9a-fA-F]{6}$/.test(c.color||'')?c.color:'#4e8290');}
const MOOD_META={'😫':{label:'很累',color:'#a87673'},'😕':{label:'低落',color:'#8873a9'},'😐':{label:'平静',color:'#668b94'},'🙂':{label:'不错',color:'#6a9c74'},'🤩':{label:'很好',color:'#c38b45'}};

function load(){
  try{
    const d=JSON.parse(localStorage.getItem(DB_KEY));
    if(!d) return null;
    if(d.version!==4||d.productId!=='everyday-worktable') return null;
    if(!Array.isArray(d.tasks)) return null;
    return d;
  }catch(e){ return null; }
}
let lastSaveError='';
let useIndexedKnowledge=false;
function save(){
  if(remoteSync.enabled&&!remoteSync.hydrating) queueRemoteSync();
  try{
    const c=Object.assign({},S);
    if(useIndexedKnowledge){ c.knowledge=[]; c.knowledgeStore='indexeddb'; persistKnowledgeLocal(S.knowledge); }
    localStorage.setItem(DB_KEY, JSON.stringify(c));
    if(remoteSync.ready&&!remoteSync.hydrating&&S._cloudAccount) localStorage.setItem(SYNC_DIRTY_KEY,'1');
    lastSaveError='';
    return true;
  }catch(e){
    lastSaveError='本地存储空间不足，请立即导出备份';
    return false;
  }
}
function openKnowledgeDB(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){ reject(new Error('IndexedDB unavailable')); return; }
    const req=indexedDB.open('everyday_worktable_knowledge_v1',1);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains('cards')) db.createObjectStore('cards'); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function persistKnowledgeLocal(cards){
  openKnowledgeDB().then(db=>{ const tx=db.transaction('cards','readwrite'); tx.objectStore('cards').put(cards,'all'); tx.oncomplete=()=>db.close(); tx.onerror=()=>db.close(); }).catch(()=>{});
}
function clearKnowledgeLocal(){
  return openKnowledgeDB().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction('cards','readwrite');
    tx.objectStore('cards').put([],'all');
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=()=>{const error=tx.error;db.close();reject(error);};
  }));
}
function initKnowledgeStore(){
  const memoryCards=(S.knowledge||[]).slice();
  openKnowledgeDB().then(db=>new Promise((resolve,reject)=>{ const req=db.transaction('cards','readonly').objectStore('cards').get('all'); req.onsuccess=()=>{db.close();resolve(req.result);}; req.onerror=()=>{db.close();reject(req.error);}; })).then(cards=>{
    useIndexedKnowledge=true;
    if(Array.isArray(cards)) S.knowledge=cards; else persistKnowledgeLocal(memoryCards);
    if(!Array.isArray(cards)) S.knowledge=memoryCards;
    S.knowledge.forEach(k=>{ if(!Array.isArray(k.tags)) k.tags=k.tag?[k.tag]:[]; k.tags=k.tags.map(kbNormTag).filter(Boolean); if(k.favorite==null) k.favorite=false; if(k.reviewCount==null) k.reviewCount=0; delete k.project; });
    save(); render(); initRemoteSync();
  }).catch(()=>{ useIndexedKnowledge=false; initRemoteSync(); });
}
function hasLocalContent(){
  const initial=seed(),sample=initial.knowledge[0],cards=S.knowledge||[];
  const sampleUntouched=cards.length===1&&cards[0].id===sample.id&&cards[0].text===sample.text&&JSON.stringify(cards[0].tags||[])===JSON.stringify(sample.tags)&&!cards[0].favorite&&!(cards[0].reviewCount||0)&&!cards[0].lastReviewed;
  return !!(S.tasks.length||!sampleUntouched||JSON.stringify(S.knowledgeTags||[])!==JSON.stringify(initial.knowledgeTags)||Object.keys(S.checkins||{}).length||Object.keys(S.notes||{}).length||Object.keys(S.moods||{}).length||JSON.stringify(S.settings)!==JSON.stringify(initial.settings)||JSON.stringify(S.projects)!==JSON.stringify(PROJECT_DEFAULTS)||JSON.stringify(S.habits)!==JSON.stringify(HABIT_DEFAULTS));
}
function syncStatus(message,refresh=true){
  if(remoteSync.mode==='local') message=message.replaceAll('云端','电脑数据库').replaceAll('上传','写入').replaceAll('补传','补存').replaceAll('本机属于另一账号','浏览器缓存属于另一工作空间').replaceAll('本机与电脑数据库','浏览器与电脑数据库');
  remoteSync.status=message;
  const el=document.getElementById('save-status');if(el) el.textContent=message;
  if(refresh&&view==='settings')render();
}
async function syncFetch(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},...options});
  const data=await response.json();
  if(!response.ok) throw Object.assign(new Error(data.error||'同步请求失败'),{status:response.status,data});
  return data;
}
function applyRemoteState(state,revision){
  remoteSync.hydrating=true;
  S=state;
  hydrateDefinitions();
  document.documentElement.dataset.theme=S.settings.theme||'light';
  document.documentElement.dataset.palette=S.settings.palette||'calm';
  S._cloudRevision=revision;
  S._cloudAccount=remoteSync.user&&remoteSync.user.email;
  remoteSync.revision=revision;
  save();
  remoteSync.hydrating=false;
  localStorage.removeItem(SYNC_DIRTY_KEY);
  render();
}
async function initRemoteSync(){
  document.getElementById('app').inert=true;
  try{
    if(location.protocol==='file:'){syncStatus('浏览器保存 · 请定期导出备份');return;}
    const me=await syncFetch('/api/me');
    remoteSync.mode=me.mode||'accounts';
    remoteSync.dataPath=me.dataPath||'';
    remoteSync.available=true;
    remoteSync.user=me.user;
    if(!me.user){syncStatus('未登录 · 当前仅保存在本机');return;}
    const remote=await syncFetch('/api/state');
    remoteSync.revision=remote.revision;
    const localDirty=localStorage.getItem(SYNC_DIRTY_KEY)==='1';
    if(S._cloudAccount&&S._cloudAccount!==me.user.email){
      remoteSync.enabled=false;remoteSync.conflict=true;syncStatus('本机属于另一账号，请选择保留哪一份数据');return;
    }
    if(!remote.state){
      if(S._cloudAccount&&S._cloudRevision){remoteSync.enabled=false;remoteSync.conflict=true;syncStatus('数据库为空，浏览器有旧数据。请确认是否恢复');return;}
      remoteSync.enabled=true;remoteSync.dirty=true;syncStatus('正在上传本机数据');queueRemoteSync();return;
    }
    if(localDirty&&S._cloudAccount===me.user.email&&S._cloudRevision===remote.revision){remoteSync.enabled=true;remoteSync.dirty=true;syncStatus('正在补传本机修改');queueRemoteSync();return;}
    if(localDirty||(hasLocalContent()&&S._cloudRevision==null)){
      remoteSync.enabled=false;remoteSync.conflict=true;syncStatus('本机与云端都有数据，请选择保留哪一份');return;
    }
    applyRemoteState(remote.state,remote.revision);
    remoteSync.enabled=true;remoteSync.conflict=false;syncStatus('已同步 · 数据保存在本机与云端');
  }catch(e){remoteSync.available=false;remoteSync.enabled=false;syncStatus('同步服务不可用 · 当前仅保存在本机');}
  finally{remoteSync.ready=true;document.getElementById('app').inert=false;initAiService();}
}
function queueRemoteSync(){
  if(!remoteSync.enabled||remoteSync.hydrating) return;
  remoteSync.dirty=true;
  try{localStorage.setItem(SYNC_DIRTY_KEY,'1');}catch{}
  syncStatus(remoteSync.mode==='local'?'正在保存到电脑…':'正在同步…',false);
  clearTimeout(remoteSync.timer);
  remoteSync.timer=setTimeout(flushRemoteSync,650);
}
async function flushRemoteSync(){
  if(!remoteSync.enabled||!remoteSync.dirty||remoteSync.pushing) return;
  remoteSync.pushing=true;remoteSync.dirty=false;
  try{
    const data=await syncFetch('/api/state',{method:'PUT',body:JSON.stringify({revision:remoteSync.revision,state:S})});
    remoteSync.revision=data.revision;
    S._cloudRevision=data.revision;
    S._cloudAccount=remoteSync.user&&remoteSync.user.email;
    remoteSync.hydrating=true;save();remoteSync.hydrating=false;
    if(remoteSync.dirty) setTimeout(flushRemoteSync,0);
    else {localStorage.removeItem(SYNC_DIRTY_KEY);syncStatus(remoteSync.mode==='local'?'已保存到电脑数据库':'已同步 · 数据保存在本机与云端');}
  }catch(e){
    remoteSync.dirty=true;
    if(e.status===409){remoteSync.enabled=false;remoteSync.conflict=true;syncStatus('检测到另一台设备的新修改，请选择保留哪一份');}
    else if(e.status===401){remoteSync.enabled=false;syncStatus('登录已失效 · 请重新登录后同步');}
    else if(e.status===413||e.status===400){remoteSync.enabled=false;syncStatus('数据库未保存：'+e.message+'。请导出备份');}
    else {syncStatus('服务暂不可用 · 修改暂存在浏览器，15 秒后重试');setTimeout(flushRemoteSync,15000);}
  }finally{remoteSync.pushing=false;}
}
async function submitSyncAuth(mode){
  const email=(document.getElementById('sync-email')||{}).value||'';
  const password=(document.getElementById('sync-password')||{}).value||'';
  try{
    await syncFetch('/api/'+mode,{method:'POST',body:JSON.stringify({email,password})});
    await initRemoteSync();toast(mode==='register'?'账号已创建':'已登录');
  }catch(e){toast(e.message);}
}
async function resolveSyncConflict(useLocal){
  try{
    const remote=await syncFetch('/api/state');
    if(useLocal){
      if(!confirm('用当前浏览器的数据覆盖数据库？建议先分别导出备份，未保留的内容会被替换。')) return;
      remoteSync.revision=remote.revision;remoteSync.enabled=true;remoteSync.conflict=false;queueRemoteSync();syncStatus('正在上传本机数据');
    }else{
      if(!confirm('用数据库的数据替换当前浏览器内容？建议先导出 JSON 备份。')) return;
      applyRemoteState(remote.state||seed(),remote.revision);remoteSync.enabled=true;remoteSync.conflict=false;syncStatus('已同步 · 数据保存在本机与云端');
    }
  }catch(e){toast(e.message);}
}
async function logoutSyncAccount(){
  if(localStorage.getItem(SYNC_DIRTY_KEY)==='1'&&!confirm('仍有尚未同步的本机修改。退出会清除本机副本，建议先导出 JSON 备份。仍要退出吗？')) return;
  try{await syncFetch('/api/logout',{method:'POST',body:'{}'});}catch(e){toast('无法连接服务，账号尚未安全退出');return;}
  remoteSync.enabled=false;clearTimeout(remoteSync.timer);
  remoteSync.user=null;remoteSync.conflict=false;remoteSync.revision=0;
  try{await clearKnowledgeLocal();}catch(e){toast('知识卡片的本机副本未能清除，请勿在共用设备上继续使用');return;}
  S=seed();hydrateDefinitions();localStorage.removeItem(SYNC_DIRTY_KEY);save();
  syncStatus('已退出 · 本机账号数据已清除');render();
}
async function aiFetch(path,options={},timeout=12000){
  const response=await fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(timeout),headers:{'Content-Type':'application/json'},...options});
  const data=await response.json().catch(()=>({error:'AI 服务返回了无法识别的数据'}));
  if(!response.ok) throw Object.assign(new Error(data.error||'AI 请求失败'),{status:response.status});
  return data;
}
async function initAiService(){
  if(location.protocol==='file:'||remoteSync.mode!=='local'){aiService.available=false;return;}
  try{const data=await aiFetch('/api/ai/settings');aiService={...aiService,...data,available:true,error:''};}
  catch(e){aiService.available=false;aiService.error=e.message;}
  render();
}
async function saveAiSettings(){
  const baseUrl=((document.getElementById('ai-base-url')||{}).value||'').trim();
  const model=((document.getElementById('ai-model')||{}).value||'').trim();
  const apiKey=((document.getElementById('ai-api-key')||{}).value||'').trim();
  try{const data=await aiFetch('/api/ai/settings',{method:'PUT',body:JSON.stringify({baseUrl,model,apiKey})});aiService={...aiService,...data,available:true,error:''};render();toast('AI 设置已保存');}
  catch(e){toast(e.message);}
}
async function testAiSettings(){
  const button=document.querySelector('[data-action="ai-test"]');if(button){button.disabled=true;button.textContent='测试中…';}
  try{await aiFetch('/api/ai/test',{method:'POST',body:'{}'},95000);toast('连接成功');}
  catch(e){toast(e.message);}
  finally{if(view==='settings')render();}
}
async function clearAiSettings(){
  if(!confirm('清除这台电脑保存的 AI 地址、模型和 API Key？')) return;
  try{await aiFetch('/api/ai/settings',{method:'DELETE',body:'{}'});aiService={...aiService,configured:false,baseUrl:'',model:'',hasKey:false,error:''};render();toast('AI 设置已清除');}
  catch(e){toast(e.message);}
}
function openAiPreview(){
  const cards=digestCards().cards.slice(0,6);
  if(cards.length<2){toast('至少需要两张知识卡片');return;}
  pendingAiCards=cards;
  const rows=cards.map((card,i)=>'<div class="ai-send-card"><span>'+(i+1)+'</span><div><b>'+esc(compactText(card.text,82))+'</b><small>'+esc((card.tags||[]).map(x=>'#'+x).join(' ')||'未分类')+'</small></div></div>').join('');
  modalRoot.innerHTML='<div class="overlay" data-overlay><div class="modal ai-preview-modal"><h3>生成知识碰撞</h3><p class="muted">以下卡片将发送到你配置的 AI 服务。</p><div class="ai-send-list">'+rows+'</div><div class="modal-actions"><button class="btn ghost" data-action="modal-cancel">取消</button><button class="btn primary" data-action="ai-generate-confirm">确认并生成</button></div></div></div>';
}
async function generateAiReading(){
  const cards=pendingAiCards.map(card=>({id:card.id,text:card.text,tags:card.tags||[],created:card.created||''}));pendingAiCards=[];
  if(cards.length<2) return;
  aiService.generating=true;render();
  try{
    const result=await aiFetch('/api/ai/digest',{method:'POST',body:JSON.stringify({cards})},95000);
    if(!S.aiReadings) S.aiReadings={};
    S.aiReadings[todayISO()]={...result,createdAt:new Date().toISOString()};save();render();toast('今日阅读已生成');
  }catch(e){aiService.error=e.message;toast(e.message);}
  finally{aiService.generating=false;render();}
}
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function todayISO(){ return isoLocal(todayMid()); }
function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.getElementById('toast-root').appendChild(t); setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),200); }, 1800); }

/* ---------------- date helpers ---------------- */
function greeting(){ const h=new Date().getHours(); return h<12?'早上好':(h<18?'下午好':'晚上好'); }
function fmtTodayLong(){ const d=new Date(); const days=['星期日','星期一','星期二','星期三','星期四','星期五','星期六']; return days[d.getDay()]+' · '+d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日'; }
function dueLabel(iso){
  if(!iso) return '';
  if(iso===todayISO()) return '今天';
  if(iso===addDaysISO(todayISO(),1)) return '明天';
  if(iso===addDaysISO(todayISO(),-1)) return '昨天';
  const d=new Date(iso+'T00:00:00');
  return (d.getMonth()+1)+'月'+d.getDate()+'日';
}
function isOverdue(t){ return t.due && t.due<todayISO() && !t.completed; }
function weekStart(){ const n=todayMid(); const dow=(n.getDay()+6)%7; const m=new Date(n); m.setDate(n.getDate()-dow); return m; }

/* ---------------- progress / metrics ---------------- */
function projProgress(proj){
  const ts=S.tasks.filter(t=>t.project===proj);
  const done=ts.filter(t=>t.completed).length;
  return ts.length?Math.round(done/ts.length*100):0;
}
function projCount(proj){
  const ts=S.tasks.filter(t=>t.project===proj);
  return ts.filter(t=>t.completed).length+' / '+ts.length;
}
/* 打卡连续天数 */
function checkinStreak(){
  let n=0; const d=new Date(todayMid());
  const hasCheckin=date=>Object.values(S.checkins[date]||{}).some(Boolean);
  if(!hasCheckin(todayISO())) d.setDate(d.getDate()-1);
  while(hasCheckin(isoLocal(d))){ n++; d.setDate(d.getDate()-1); }
  return n;
}
/* 本周任务完成度 */
function weekTaskStats(){
  const mon=weekStart(); const lo=isoLocal(mon), hi=addDaysISO(lo,6);
  const ts=S.tasks.filter(t=>t.due>=lo && t.due<=hi);
  const done=ts.filter(t=>t.completed).length;
  return { total:ts.length, done, pct: ts.length?Math.round(done/ts.length*100):0 };
}

/* ---------------- derived lists ---------------- */
function focusTasks(){
  const list=S.tasks.filter(t=>!t.completed);
  const imp={work:5,learning:4,health:3,life:3};
  list.sort((a,b)=>{
    const oa=isOverdue(a)?1:0, ob=isOverdue(b)?1:0; if(oa!==ob) return ob-oa;
    const da=a.due||'9999', db=b.due||'9999'; if(da!==db) return da<db?-1:1;
    const pa={'high':3,'medium':2,'low':1}[a.priority]||1, pb={'high':3,'medium':2,'low':1}[b.priority]||1; if(pa!==pb) return pb-pa;
    return (imp[b.project]||0)-(imp[a.project]||0);
  });
  return list.slice(0,5);
}
function upcoming(){
  const lo=addDaysISO(todayISO(),1), hi=addDaysISO(todayISO(),7), out=[];
  S.tasks.forEach(t=>{ if(!t.completed && t.due>=lo && t.due<=hi) out.push({date:t.due,proj:t.project,title:t.title}); });
  out.sort((a,b)=>a.date<b.date?-1:1); return out;
}
function upcomingDays(n){
  const lo=addDaysISO(todayISO(),1), hi=addDaysISO(todayISO(),n), out=[];
  S.tasks.forEach(t=>{ if(!t.completed && t.due>=lo && t.due<=hi) out.push({date:t.due,proj:t.project,title:t.title}); });
  out.sort((a,b)=>a.date<b.date?-1:1); return out;
}
function todayTasks(){ return S.tasks.filter(t=>!t.completed && t.due && t.due<=todayISO()).slice(0,8); }

/* ---------------- 每日知识温故（本地选卡；洞察生成需接入 AI） ---------------- */
function hashText(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function dayDiff(a,b){ const x=new Date(a+'T00:00:00'), y=new Date(b+'T00:00:00'); return Math.max(0,Math.round((y-x)/86400000)); }
function compactText(s,n){ s=String(s||'').replace(/\s+/g,' ').trim(); return s.length>n?s.slice(0,n).replace(/[，。；、\s]+$/,'')+'…':s; }
function digestCards(){
  const all=(S.knowledge||[]).filter(k=>(k.text||'').trim());
  if(!all.length) return {topic:'',cards:[]};
  const counts={}; all.forEach(k=>(k.tags||[]).forEach(t=>counts[t]=(counts[t]||0)+1));
  const topics=Object.keys(counts).filter(t=>counts[t]>=2).sort();
  const seed=hashText(todayISO());
  const topic=topics.length?topics[seed%topics.length]:'';
  let pool=topic?all.filter(k=>(k.tags||[]).includes(topic)):all.slice();
  if(pool.length<3) pool=all.slice();
  pool.sort((a,b)=>{
    const ar=dayDiff(a.lastReviewed||a.created||todayISO(),todayISO())*100+(hashText(todayISO()+a.id)%97);
    const br=dayDiff(b.lastReviewed||b.created||todayISO(),todayISO())*100+(hashText(todayISO()+b.id)%97);
    return br-ar;
  });
  if(pool.length>1&&digestShuffle){const shift=digestShuffle%pool.length;pool=pool.slice(shift).concat(pool.slice(0,shift));}
  return {topic:topic,cards:pool.slice(0,Math.min(4,pool.length))};
}
function aiReadingToday(){return S.aiReadings&&S.aiReadings[todayISO()];}
function localReviewHTML(d){
  const main=d.cards[0],related=d.cards.slice(1,4);
  const created=String(main.created||todayISO()).slice(0,10),age=dayDiff(created,todayISO());
  const tags=(main.tags||[]).map(t=>'<span class="tag">#'+esc(t)+'</span>').join('');
  const nearby=related.map(k=>'<button class="local-related" data-action="kb-open" data-id="'+esc(k.id)+'"><small>'+esc(String(k.created||'').slice(0,10)||'旧卡片')+'</small><b>'+esc(compactText(k.text,120))+'</b></button>').join('');
  const canExpand=String(main.text||'').replace(/\s+/g,' ').trim().length>150;
  return '<article class="knowledge-digest local-review"><div class="digest-head"><div><h2>今日重读</h2></div><span class="local-badge">本地</span></div>'
    +'<div class="review-reason"><i></i><span>'+(age?age+' 天前记录':'今天记录')+(main.reviewCount?' · 已回顾 '+main.reviewCount+' 次':' · 尚未回顾')+'</span></div>'
    +'<div class="review-focus"><span>'+esc(created)+'</span><p class="review-text">'+esc(main.text)+'</p><div class="review-tags">'+tags+'</div><div class="review-inline-actions">'+(canExpand?'<button class="text-action" data-action="review-expand" aria-expanded="false">展开全文</button>':'')+'<button class="text-action" data-action="kb-open" data-id="'+esc(main.id)+'">打开原卡片</button></div></div>'
    +'<div class="review-actions"><button class="btn ghost sm" data-action="ai-reflect" data-id="'+esc(main.id)+'">写下新想法</button><button class="btn ghost sm" data-action="kb-favorite" data-id="'+esc(main.id)+'">'+(main.favorite?'已收藏':'收藏')+'</button><button class="btn ghost sm" data-action="digest-shuffle">换一张</button>'+(aiService.configured?'<button class="btn primary sm" data-action="ai-preview">生成知识碰撞</button>':'')+'</div>'
    +(nearby?'<div class="local-related-wrap"><h3>相关卡片</h3><div>'+nearby+'</div></div>':'')+'</article>';
}
function aiReadingHTML(reading){
  const d=reading.digest||reading;
  const connections=(d.connections||[]).map(item=>'<div class="ai-connection"><b>'+esc(item.title)+'</b><p>'+esc(item.body)+'</p><div>'+((item.sourceIds||[]).map(id=>{const n=(S.knowledge||[]).find(k=>k.id===id);return n?'<button data-action="kb-open" data-id="'+esc(id)+'">'+esc(compactText(n.text,28))+'</button>':'';}).join(''))+'</div></div>').join('');
  return '<article class="knowledge-digest ai-reading"><div class="digest-head"><div><h2>'+esc(d.title)+'</h2></div><span class="local-badge">AI</span></div><p class="ai-lead">'+esc(d.lead)+'</p><div class="ai-insight">'+esc(d.insight)+'</div>'+(connections?'<div class="ai-connections">'+connections+'</div>':'')+(d.tension?'<div class="ai-tension"><b>另一面</b><p>'+esc(d.tension)+'</p></div>':'')+(d.action?'<div class="ai-action"><b>今天可以试试</b><p>'+esc(d.action)+'</p></div>':'')+(d.question?'<div class="ai-question">'+esc(d.question)+'</div>':'')+'<div class="review-actions"><button class="btn ghost sm" data-action="ai-preview">重新生成</button><button class="btn ghost sm" data-action="ai-remove">返回本地回顾</button></div></article>';
}
function dailyDigestHTML(){
  const d=digestCards();
  if(!d.cards.length) return '<div class="knowledge-digest empty-digest"><div><b>还没有知识卡片</b><p>记录几张卡片后，这里会每天带回一张。</p></div><button class="btn primary sm" data-nav="knowledge">去记录</button></div>';
  if(aiService.generating) return '<article class="knowledge-digest digest-loading"><div class="digest-head"><div><h2>正在寻找卡片之间的联系</h2></div><span class="local-badge">AI</span></div><div class="digest-loader"><i></i><span>生成通常需要几十秒</span></div></article>';
  const reading=aiReadingToday();
  return reading?aiReadingHTML(reading):localReviewHTML(d);
}

/* ---------------- reusable bits ---------------- */
function projectIcon(P,size){ return ic(P.icon,size||15); }
function checkinIcon(c,size){ return ic(c.icon,size||17); }
function sectionTitle(icon,title,meta){ return '<div class="section-title">'+ic(icon,15)+'<span>'+esc(title)+'</span>'+(meta?'<span class="section-meta">'+meta+'</span>':'')+'</div>'; }
function projBadge(proj){ const P=PROJECTS[proj]||{icon:'target',short:'未分类',color:'#77837f'}; return '<span class="pill project-pill" data-project="'+esc(proj)+'" style="--project-color:'+esc(P.color)+'">'+projectIcon(P,13)+' '+esc(P.short)+'</span>'; }
function hexA(hex,a){ const n=parseInt(hex.slice(1),16); const r=(n>>16)&255,g=(n>>8)&255,b=n&255; return 'rgba('+r+','+g+','+b+','+a+')'; }
function stars(n){ let s=''; for(let i=1;i<=5;i++) s+='<span class="'+(i<=n?'':'off')+'">★</span>'; return '<span class="stars">'+s+'</span>'; }
function prioPill(p){ const c=PRIORITY[p].color; return '<span class="pill" style="color:'+c+';border-color:'+hexA(c,.3)+';background:'+hexA(c,.12)+'">'+PRIORITY[p].label+'</span>'; }
function checkEl(t){ return '<div class="check'+(t.completed?' done':'')+'" data-action="complete" data-id="'+t.id+'" title="Toggle complete">'+ic('check',14)+'</div>'; }
function statCard(num,lbl,color){ return '<div class="card" style="padding:14px;flex:1;min-width:130px"><div class="stat-num" style="color:'+color+'">'+num+'</div><div class="stat-lbl">'+lbl+'</div></div>'; }

/* ---------------- SCROLL PRESERVATION ---------------- */
const SCROLL_SEL = '#main,#sidebar,.kcol-body,.uboard,.copy-board,.cal-grid,.calendar-wrap';
let scrollReset = false;
let scrollMemo  = null;
function elPath(el){ const parts=[]; let cur=el; while(cur && cur.id!=='app'){ const p=cur.parentNode; if(!p || p.nodeType!==1) return null; parts.push(Array.prototype.indexOf.call(p.children,cur)); cur=p; } if(!cur) return null; return parts.reverse().join('.'); }
function pathEl(path){ let el=document.getElementById('app'); if(!el) return null; if(path==='') return el; const ix=path.split('.'); for(let i=0;i<ix.length;i++){ el=el.children[+ix[i]]; if(!el) return null; } return el; }
function captureScroll(){ const out=[]; try{ const list=document.querySelectorAll(SCROLL_SEL); for(let i=0;i<list.length;i++){ const el=list[i]; if(el.scrollTop||el.scrollLeft){ const p=elPath(el); if(p!==null) out.push([p,el.scrollTop,el.scrollLeft]); } } const se=document.scrollingElement||document.documentElement; if(se && se.scrollTop) out.push(['@doc',se.scrollTop,0]); }catch(e){} return out; }
function restoreScroll(memo){ if(!memo||!memo.length) return; for(let i=0;i<memo.length;i++){ const it=memo[i]; try{ if(it[0]==='@doc'){ const se=document.scrollingElement||document.documentElement; if(se) se.scrollTop=it[1]; continue; } const el=pathEl(it[0]); if(el){ if(it[1]) el.scrollTop=it[1]; if(it[2]) el.scrollLeft=it[2]; } }catch(e){} } }
function focusKeep(id, caretEnd){ const el=document.getElementById(id); if(el){ el.focus(); if(caretEnd && el.setSelectionRange){ const n=el.value.length; el.setSelectionRange(n,n); } else if(el.select) el.select(); scrollMemo=null; } }

/* ---------------- RENDER ---------------- */
function render(){
  const app=document.getElementById('app');
  const memo = scrollReset ? null : captureScroll();
  scrollReset = false;
  app.innerHTML = sidebarHTML() + '<main id="main"><div class="topbar">'+topbarHTML()+'</div><div class="main-inner" id="view">'+viewHTML()+'</div></main>';
  scrollMemo = memo;
  if(view==='projects') bindProjects();
  if(view==='knowledge'){
    const kq=document.getElementById('kb-search');
    if(kq){
      let composing=false;
      const commit=()=>{
        kbQuery=kq.value; kbFocusId=null; kbLimit=30;
        const feed=document.getElementById('kb-feed');
        if(feed){ feed.innerHTML=kbFeedHTML(); bindKnowledgeEditors(); }
      };
      kq.oncompositionstart=()=>{ composing=true; };
      kq.oncompositionend=()=>{ composing=false; commit(); };
      kq.oninput=()=>{ if(!composing) commit(); };
    }
    const ks=document.getElementById('kb-sort');
    if(ks){ ks.onchange=()=>{ kbSort=ks.value; kbLimit=30; render(); }; }
    bindKnowledgeEditors();
  }
  restoreScroll(memo);
  if(memo && memo.length && typeof requestAnimationFrame==='function'){ requestAnimationFrame(()=>{ if(scrollMemo===memo) restoreScroll(memo); }); }
}

function sidebarHTML(){
  let h='<aside id="sidebar"><div class="brand"><span class="logo">D</span><span>Dayloom</span></div>';
  NAV.forEach(n=>{
    const active = (view===n.view)?' active':'';
    let dot='';
    if(n.view==='today'){ const overdueCount=S.tasks.filter(t=>isOverdue(t)).length; if(overdueCount) dot='<span class="nav-alert" title="'+overdueCount+' 项逾期任务">'+overdueCount+'</span>'; }
    const ico = ICONS[n.icon] ? '<span class="ico">'+ic(n.icon,17)+'</span>' : '<span class="ico">'+n.icon+'</span>';
    h+='<button class="nav-item'+active+'" data-nav="'+n.view+'" aria-current="'+(active?'page':'false')+'">'+ico+'<span>'+esc(n.label)+'</span>'+dot+'</button>';
  });
  h+='<div class="sidebar-foot" id="save-status" role="status">'+esc(remoteSync.status)+'</div></aside>';
  h+='<div class="scrim" id="scrim"></div>';
  return h;
}

function topbarHTML(){
  const g=greeting();
  let qa='';
  if(qaOpen){
    const items=[['task','新任务'],['knowledge','知识卡片'],['review','今日温故']];
    qa='<div class="qa-menu" style="position:absolute;top:54px;right:28px;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:6px;min-width:180px;z-index:40">'
      + items.map(i=>'<button class="nav-item" data-action="qa" data-type="'+i[0]+'" style="border-radius:8px;width:100%">'+esc(i[1])+'</button>').join('')
      + '</div><div id="qa-back" style="position:fixed;inset:0;z-index:30"></div>';
  }
  const displayName=String(S.settings.name||'').trim();
  return '<div class="greet">'+g+(displayName?'，'+esc(displayName):'')+'</div>'
    + '<div class="date">'+fmtTodayLong()+'</div>'
    + '<div class="search"><span class="si">'+ic('search',16)+'</span><input id="globsearch" placeholder="搜索任务 / 知识..." data-action="search" readonly aria-label="打开全局搜索"/></div>'
    + '<button class="btn primary" data-action="add">'+ic('plus',16)+' 添加</button>'
    + '<button class="icon-btn" data-action="theme-toggle" title="切换亮 / 暗色">'+ic(document.documentElement.dataset.theme==='dark'?'sun':'moon',17)+'</button>'
    + '<button class="icon-btn menu-btn" data-action="menu">'+ic('menu',18)+'</button>'
    + qa;
}

function viewHTML(){
  switch(view){
    case 'home': return viewHome();
    case 'today': return viewToday();
    case 'calendar': return viewCalendar();
    case 'projects': return viewProjects();
    case 'knowledge': return viewKnowledge();
    case 'statistics': return viewStats();
    case 'settings': return viewSettings();
    default: return viewHome();
  }
}

/* ---------------- HOME（紧凑） ---------------- */
const QUOTES = [
  '把重要的事放在今天，慢慢推进。',
  '照顾生活，也照顾正在努力的自己。',
  '留一点时间给长期想做的事。',
  '先完成，再完美。',
  '打卡不是形式，是和自己的约定。',
  '今天的确定性，来自昨天的积累。'
];
function viewHome(){
  const q=QUOTES[hashText(todayISO())%QUOTES.length];
  const rec0=S.checkins[todayISO()]||{};
  let h='';
  /* Banner：左=今日提示，右=快速添加 */
  h+='<div class="banner">'
    + '<div class="banner-left">'
    +   '<div class="banner-hi">把日常收进 Dayloom</div>'
    +   '<div class="banner-q">'+esc(q)+'</div>'
    +   '<div class="banner-date">'+fmtTodayLong()+'</div>'
    +   '<div class="banner-stats">'
    +     '<div class="bs"><div class="bs-n">'+S.tasks.filter(t=>t.completed).length+'</div><div class="bs-l">已完成</div></div>'
    +     '<div class="bs"><div class="bs-n">'+S.tasks.filter(t=>!t.completed).length+'</div><div class="bs-l">进行中</div></div>'
    +     '<div class="bs"><div class="bs-n">'+checkinStreak()+'</div><div class="bs-l">打卡连续</div></div>'
    +   '</div>'
    + '</div>'
    + '<div class="banner-right"><div class="home-add">'
    +   '<div class="ha-cap">'+ic('plus',13)+' 快速添加任务</div>'
    +   '<input id="home-task-title" placeholder="今天要做什么？" />'
    +   '<div class="ha-row">'
    +     '<select id="home-task-proj">'+PROJ_ORDER.map(p=>'<option value="'+p+'">'+esc(PROJECTS[p].short)+'</option>').join('')+'</select>'
    +     '<button class="btn primary sm" data-action="home-task-add">添加</button>'
    +   '</div></div></div>'
    + '</div>';

  /* 本周完成度 + 打卡记录 */
  const ws=weekTaskStats();
  const ws0=isoLocal(weekStart());
  const projectWeek=PROJ_ORDER.map(p=>{ const ts=S.tasks.filter(t=>t.project===p&&t.due>=ws0&&t.due<=addDaysISO(ws0,6)); return {p:p,total:ts.length,done:ts.filter(t=>t.completed).length}; }).filter(x=>x.total);
  h+='<div class="home-grid">'
    + '<div class="card home-week">'+sectionTitle('calendar','本周完成度',ws.done+' / '+ws.total)
    +   '<div class="week-overview"><div class="week-score"><strong>'+ws.pct+'</strong><span>%</span></div><div class="week-copy"><b>'+ws.done+' 项已完成</b><span>'+(ws.total?('还有 '+Math.max(0,ws.total-ws.done)+' 项待推进'):'本周尚未安排任务')+'</span></div></div>'
    +   '<div class="week-project-list">'+(projectWeek.length?projectWeek.map(x=>'<div class="week-project-row" data-project="'+esc(x.p)+'" style="--project-color:'+esc(PROJECTS[x.p].color)+'"><span>'+projectIcon(PROJECTS[x.p],14)+esc(PROJECTS[x.p].short)+'</span><b>'+x.done+' / '+x.total+'</b></div>').join(''):'<div class="week-empty">添加任务后，这里会显示本周结构。</div>')+'</div></div>'
    + '<div class="card home-ck">'+sectionTitle('check','打卡','近 7 天，连续 '+checkinStreak()+' 天')
    +   '<div class="ck-row">'
    +     CHECKIN_DEFS.map(c=>{ const on=!!rec0[c.k]; return '<button class="ck-chip'+(on?' on':'')+'" data-action="ci" data-k="'+c.k+'"><span class="ck-e">'+checkinIcon(c,15)+'</span>'+c.l+'</button>'; }).join('')
    +   '</div>'
    +   '<div class="ck-grid">'
    +     CHECKIN_DEFS.map(c=>{ let row='<div class="ck-gl">'+checkinIcon(c,14)+'</div>'; for(let i=6;i>=0;i--){ const d=addDaysISO(todayISO(),-i); const on=!!((S.checkins[d]||{})[c.k]); row+='<span class="ck-cell'+(on?' on':'')+'" title="'+d+'"></span>'; } return row; }).join('')
    +   '</div>'
    + '</div>'
    + '</div>';

  /* 今日任务 / 近 3 天（左右两栏） */
  const tts=todayTasks();
  const up=upcomingDays(3);
  h+='<div class="home-cols">'
    + '<div class="home-col">'+sectionTitle('target','今日任务',tts.length+' 项')+'<div class="card list-card">'
    +   (tts.length? tts.map(homeTaskRow).join('') : '<div class="empty">今天没有待办。</div>')
    + '</div></div>'
    + '<div class="home-col">'+sectionTitle('clock','近 3 天',up.length+' 项')+'<div class="card list-card">'
    +   (up.length? up.map(u=>{ const d=new Date(u.date+'T00:00:00'); const P=PROJECTS[u.proj]; return '<div class="list-item">'+projBadge(u.proj)+'<div class="li-body"><div class="li-title">'+esc(u.title)+'</div><div class="li-meta">'+projectIcon(P,13)+' '+esc(P.name)+' <span class="meta-sep"></span> '+dueLabel(u.date)+'</div></div></div>'; }).join('') : '<div class="empty">未来三天没有安排。</div>')
    + '</div></div>'
    + '</div>';
  return h;
}
function homeTaskRow(t){
  return '<div class="list-item">'+checkEl(t)
    + '<div class="li-body"><div class="li-title">'+esc(t.title)+'</div>'
    + '<div class="li-meta">'+projBadge(t.project)+prioPill(t.priority)+(t.estimate?'<span class="pill gray">约 '+t.estimate+' 分钟</span>':'')+(t.knowledgeId?'<span class="pill gray">关联知识</span>':'')+(t.due&&t.due<todayISO()?'<span class="pill red">已逾期</span>':'')+'</div></div>'
    + '<div class="li-actions"><button class="li-act" data-action="edit" data-kind="task" data-id="'+t.id+'">'+ic('edit',15)+'</button></div></div>';
}
function focusTaskRow(t){
  return '<div class="list-item">'+checkEl(t)+'<div class="li-body"><div class="li-title">'+esc(t.title)+'</div><div class="li-meta">'+projBadge(t.project)+prioPill(t.priority)+(t.due?'<span class="pill gray">'+dueLabel(t.due)+'</span>':'')+(t.estimate?'<span class="pill gray">'+t.estimate+' 分钟</span>':'')+'</div></div><div class="li-actions"><button class="btn ghost tiny" data-action="task-tomorrow" data-id="'+t.id+'">移到明天</button><button class="li-act" data-action="edit" data-kind="task" data-id="'+t.id+'" title="编辑">'+ic('edit',15)+'</button></div></div>';
}

/* ---------------- TODAY（打卡 + 心情 + 随笔） ---------------- */
function viewToday(){
  const d=todayISO();
  const rec=S.checkins[d]||{};
  const mood=S.moods[d]||'';
  const todayFocus=focusTasks().slice(0,3);
  let h='<div class="page-head"><div class="page-title">今日</div><div class="page-desc">'+fmtTodayLong()+'</div></div>';
  /* 主记录区：随笔是主操作，状态记录作为侧栏 */
  h+='<div class="today-top-grid"><section>'+sectionTitle('note','今日随笔')
    + '<div class="card today-note-card"><textarea id="notes-in" placeholder="记录今天的想法、复盘或灵感" rows="7"></textarea><div class="today-note-actions"><span>保存后进入本地知识库</span><button class="btn primary" data-action="notes-save">'+ic('send',14)+' 保存</button></div></div></section>'
    + '<section>'+sectionTitle('activity','今日状态')+'<div class="card today-state-card">'
    + '<div class="state-label state-label-actions">打卡<button class="text-action" data-nav="settings">管理打卡</button></div><div class="ci-grid today-ci">'
    + CHECKIN_DEFS.map(c=>{ const on=!!rec[c.k]; return '<button class="ci-btn'+(on?' on':'')+'" style="'+habitStyle(c)+'" data-action="ci" data-k="'+esc(c.k)+'"><span class="ci-e habit-emoji">'+esc(c.emoji)+'</span><span class="ci-l">'+esc(c.l)+'</span></button>'; }).join('')
    + '</div><div class="state-rule"></div><div class="state-label">心情</div><div class="mood-row">'
    + MOODS.map(m=>'<button class="mood'+(mood===m?' on':'')+'" style="--mood-color:'+MOOD_META[m].color+'" data-action="mood" data-v="'+m+'"><span class="mood-emoji">'+m+'</span><span>'+MOOD_META[m].label+'</span></button>').join('')
    + '</div></div></section></div>';
  /* 聚焦在前，阅读在后：桌面端并排，窄屏按此顺序纵向排列 */
  h+='<div class="today-insight-grid"><section>'+sectionTitle('target','今日聚焦')+'<div class="card list-card'+(todayFocus.length?'':' focus-empty-card')+'">'
    + (todayFocus.length?todayFocus.map(focusTaskRow).join(''):'<div class="empty compact focus-empty">今天没有待办。</div>')
    + '</div></section><section>'+sectionTitle('book','每日知识阅读')+dailyDigestHTML()+'</section></div>';
  return h;
}

/* ---------------- CALENDAR（周看板 / 月看板） ---------------- */
function dayEvents(iso){
  return S.tasks.filter(t=>t.due===iso).map(t=>({proj:t.project,title:t.title,id:t.id}));
}
function viewCalendar(){
  const mon=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  let h='<div class="cal-head"><h1 class="standalone-title">'+ic('calendar',20)+' 日历</h1>'
    + '<div class="seg" style="margin-right:10px"><button class="'+(calMode==='month'?'on':'')+'" data-action="cal-mode" data-mode="month">月看板</button><button class="'+(calMode==='week'?'on':'')+'" data-action="cal-mode" data-mode="week">周看板</button></div>'
    + '<div class="cal-nav"><button class="icon-btn" data-action="cal-prev" aria-label="上一'+(calMode==='month'?'月':'周')+'">'+ic('chevL',16)+'</button><button class="icon-btn" data-action="cal-next" aria-label="下一'+(calMode==='month'?'月':'周')+'">'+ic('chevR',16)+'</button></div></div>';
  if(calMode==='month'){
    h+='<div class="calendar-wrap"><div style="font-weight:700;margin-bottom:10px">'+calCursor.getFullYear()+'年'+mon[calCursor.getMonth()]+'</div>';
    h+='<div class="cal-grid">';
    ['周一','周二','周三','周四','周五','周六','周日'].forEach(d=>h+='<div class="cal-dow">'+d+'</div>');
    const cur=new Date(calCursor.getFullYear(),calCursor.getMonth(),1);
    const sd=(cur.getDay()+6)%7; const gs=new Date(cur); gs.setDate(1-sd);
    for(let i=0;i<42;i++){ const d=new Date(gs); d.setDate(gs.getDate()+i);
      const iso=isoLocal(d); const dim=d.getMonth()!==calCursor.getMonth();
      const isT=iso===todayISO();
      h+='<div class="cal-cell'+(dim?' dim':'')+(isT?' today':'')+'" data-drop="cal" data-date="'+iso+'" data-action="add-on-date">'
        + '<div class="cal-num">'+d.getDate()+'</div>'+dayEvents(iso).map(ev=>'<div class="cal-ev" style="background:'+hexA(PROJECTS[ev.proj].color,.15)+';color:'+PROJECTS[ev.proj].color+'" draggable="true" data-drag="cal" data-id="'+ev.id+'">'+esc(ev.title)+'</div>').join('')
        + '</div>';
    }
    h+='</div></div>';
  } else {
    const mon2=new Date(calCursor.getFullYear(),calCursor.getMonth(),calCursor.getDate());
    mon2.setDate(mon2.getDate()-(mon2.getDay()+6)%7);
    const weekEnd=new Date(mon2);weekEnd.setDate(mon2.getDate()+6);
    h+='<div class="calendar-wrap"><div style="font-weight:700;margin-bottom:10px">'+(mon2.getMonth()+1)+'/'+mon2.getDate()+' – '+(weekEnd.getMonth()+1)+'/'+weekEnd.getDate()+'</div>';
    h+='<div class="week-board">';
    for(let i=0;i<7;i++){ const d=new Date(mon2); d.setDate(mon2.getDate()+i); const iso=isoLocal(d); const isT=iso===todayISO();
      h+='<div class="wb-col" data-drop="cal" data-date="'+iso+'">'
        + '<div class="wb-head'+(isT?' today':'')+'">'+['周一','周二','周三','周四','周五','周六','周日'][i]+' '+d.getDate()+'日</div>'
        + '<div class="wb-body">'+dayEvents(iso).map(ev=>'<div class="wb-card" draggable="true" data-drag="cal" data-id="'+ev.id+'" style="border-left:3px solid '+PROJECTS[ev.proj].color+'">'+projBadge(ev.proj)+'<div class="wb-t">'+esc(ev.title)+'</div></div>').join('')+'</div>'
        + '<button class="kadd" data-action="add-on-date" data-date="'+iso+'">'+ic('plus',12)+' 添加</button></div>';
    }
    h+='</div></div>';
  }
  return h;
}

/* ---------------- 项目（总进度 + 任务看板） ---------------- */
function boardColOf(t){ return t.completed?'done':(t.status==='inprogress'?'inprogress':(t.status==='review'?'review':'backlog')); }
function projTasksOf(proj){ let ts=S.tasks.filter(t=>t.project===proj); return ts; }
function viewProjects(){
  let h='<h1 class="standalone-title">'+ic('target',20)+' 项目</h1>';
  h+='<div class="manage-lead"><p class="muted">按自己的节奏整理项目；下方可拖拽任务状态。</p><button class="btn sm" data-action="project-add">'+ic('plus',14)+' 新增项目</button></div>';

  /* 总进度卡片 */
  h+='<div class="proj-grid">';
  PROJ_ORDER.forEach(p=>{ const P=PROJECTS[p], pr=projProgress(p);
    h+='<div class="proj-card" data-action="proj-open" data-proj="'+esc(p)+'" style="cursor:pointer;--project-color:'+esc(P.color)+'">'
      + '<div class="proj-top"><span class="proj-ico">'+projectIcon(P,20)+'</span>'
      + '<div style="flex:1"><div class="proj-name">'+esc(P.name)+'</div><div class="proj-sub">'+esc(projCount(p))+'</div></div>'
      + '<button class="icon-btn project-edit" data-action="project-edit" data-key="'+esc(p)+'" title="编辑项目 '+esc(P.name)+'" aria-label="编辑项目 '+esc(P.name)+'">'+ic('edit',14)+'</button><div class="proj-pct">'+pr+'%</div></div>'
      + '<div class="bar"><i style="width:'+pr+'%"></i></div></div>';
  });
  h+='</div>';

  /* 统一任务看板 */
  h+=sectionTitle('columns','任务看板','拖拽改状态，点击标题编辑');
  h+='<div class="fbar">'
    + '<div class="seg">'
    + '<button data-action="proj-filter" data-v="all" class="'+(projFilter==='all'?'on':'')+'">全部</button>'
    + PROJ_ORDER.map(p=>'<button data-action="proj-filter" data-v="'+p+'" data-project="'+p+'" class="'+(projFilter===p?'on':'')+'">'+PROJECTS[p].short+'</button>').join('')
    + '</div>'
    + '<span class="grow"></span>'
    + '<button class="btn primary sm" data-action="task-add">'+ic('plus',13)+' 新任务</button></div>';
  h+='<div class="uboard" id="uboard">';
  BOARD_COLS.forEach(col=>{
    let list=S.tasks.filter(t=>boardColOf(t)===col.key);
    if(projFilter!=='all') list=list.filter(t=>t.project===projFilter);
    h+='<div class="ucol" data-drop="ub-col" data-status="'+col.key+'">'
      + '<div class="kcol-head"><span>'+col.label+'</span><span class="kc-n">'+list.length+'</span></div>'
      + '<div class="kcol-body">'+ (list.length?list.map(uTaskHTML).join(''):'<div class="column-empty">暂无任务</div>') +'</div>'
      + '<div class="kcol-foot"><button class="kadd" data-action="task-add-status" data-status="'+col.key+'">'+ic('plus',12)+' 新增</button></div></div>';
  });
  h+='</div>';
  return h;
}
function uTaskHTML(t){
  const ov=isOverdue(t);
  let h='<div class="ktask'+(t.completed?' is-done':'')+(ov?' ov':'')+'" draggable="true" data-drag="ub" data-id="'+t.id+'" data-project="'+esc(t.project)+'">';
  h+='<div class="kt-acts"><button class="li-act" data-action="edit" data-kind="task" data-id="'+t.id+'" title="Edit">'+ic('dots',13)+'</button>'
    + '<button class="li-act" data-action="task-del" data-id="'+t.id+'" title="Delete">'+ic('trash',13)+'</button></div>';
  h+='<div class="kt-top">'+checkEl(t)+'<div class="kt-title">'+esc(t.title)+'</div></div>';
  h+='<div class="kt-meta">'+projBadge(t.project)+prioPill(t.priority);
  if(t.estimate) h+='<span class="pill gray">约 '+t.estimate+' 分钟</span>';
  if(t.knowledgeId) h+='<button class="pill gray" data-action="kb-open" data-id="'+esc(t.knowledgeId)+'">关联知识</button>';
  if(t.due) h+='<span class="pill '+(ov?'red':'gray')+'">'+dueLabel(t.due)+'</span>';
  h+='</div></div>';
  return h;
}
function bindProjects(){
  const qa=document.getElementById('qa'); // noop placeholder
}

/* ---------------- 知识库：左栏标签树 + 右栏笔记流 ---------------- */
let kbFilter='all';            // 当前筛选标签
let kbSelTags=new Set();       // 记录输入框里选中的标签（点击选择）
let kbQuery='';
let kbSort='newest';
let kbOpenTags=new Set();
let kbLimit=30;
let kbEditingId=null;
let kbFocusId=null; // 今日阅读跳转按稳定 ID 定位，不把正文塞进搜索框
let kbEditTags=new Set();
function kbNormTag(value){ return String(value||'').replace(/^#+/,'').split('/').map(x=>x.trim()).filter(Boolean).join('/'); }
function kbInlineTags(text){ const out=[]; String(text||'').replace(/#([^\s#，。！？；;,.<>]+)/g,(_,raw)=>{ const t=kbNormTag(raw); if(t&&!out.includes(t)) out.push(t); return _; }); return out; }
/* 全部标签：来自知识库内容 + 用户新建的标签仓库 */
function kbAllTags(){
  const m=new Map();
  S.knowledge.forEach(k=>(k.tags||[]).forEach(raw=>{ const t=kbNormTag(raw); if(t) m.set(t,(m.get(t)||0)+1); }));
  (S.knowledgeTags||[]).forEach(raw=>{ const t=kbNormTag(raw); if(t&&!m.has(t)) m.set(t,0); });
  return [...m.entries()].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
}
function kbTagPaths(){
  const paths=new Map();
  kbAllTags().forEach(tag=>{
    let path='';
    tag.name.split('/').forEach((part,index)=>{
      const parent=path;
      path=path?path+'/'+part:part;
      const old=paths.get(path)||{path:path,parent:parent,name:part,depth:index+1,count:0};
      old.count+=tag.count;
      paths.set(path,old);
    });
  });
  return [...paths.values()].sort((a,b)=>b.count-a.count||a.path.localeCompare(b.path,'zh-CN'));
}
function kbRegisterTags(tags){
  const known=new Set((S.knowledgeTags||[]).map(kbNormTag).filter(Boolean));
  (tags||[]).map(kbNormTag).filter(Boolean).forEach(tag=>{
    known.add(tag);
    const parts=tag.split('/');
    for(let i=1;i<parts.length;i++) kbOpenTags.add(parts.slice(0,i).join('/'));
  });
  S.knowledgeTags=[...known];
}
function kbTagSuggestions(raw){
  raw=String(raw||'').replace(/^#+/,'');
  const parts=raw.split('/');
  const partial=(parts.pop()||'').toLocaleLowerCase('zh-CN');
  const parent=parts.join('/');
  const depth=parts.length+1;
  const catalog=kbTagPaths();
  const items=catalog.filter(item=>item.depth===depth&&item.parent===parent&&item.name.toLocaleLowerCase('zh-CN').includes(partial));
  const candidate=kbNormTag(raw);
  const canCreate=!!candidate&&!catalog.some(item=>item.path===candidate);
  return {items:items,candidate:candidate,canCreate:canCreate,parent:parent};
}
function kbTagContext(input){
  const caret=input.selectionStart==null?input.value.length:input.selectionStart;
  const left=input.value.slice(0,caret);
  const match=left.match(/(?:^|[\s，。！？；;,.])#([^\s#，。！？；;,.]*)$/);
  if(!match) return null;
  return {raw:match[1],start:left.lastIndexOf('#'),end:caret};
}
function kbTagChipsHTML(tags,removeAction){
  const list=[...tags];
  if(!list.length) return '<span class="kb-tag-empty">还没有标签</span>';
  return list.map(tag=>'<span class="kb-edit-chip">#'+esc(tag)+'<button type="button" data-action="'+removeAction+'" data-tag="'+esc(tag)+'" aria-label="移除标签 #'+esc(tag)+'">×</button></span>').join('');
}
function kbSuggestionHTML(raw){
  const result=kbTagSuggestions(raw);
  let html=result.items.map((item,index)=>'<button type="button" class="kb-tag-suggestion'+(index===0?' active':'')+'" data-kb-suggest="'+esc(item.path)+'"><span>#'+esc(item.path)+'</span><small>'+item.count+' 张卡片</small></button>').join('');
  if(result.canCreate) html+='<button type="button" class="kb-tag-suggestion create'+(!result.items.length?' active':'')+'" data-kb-suggest="'+esc(result.candidate)+'"><span>新建 #'+esc(result.candidate)+'</span><small>保存后加入全部标签</small></button>';
  if(!html) html='<div class="kb-tag-suggest-empty">'+(result.parent?'继续输入子标签名称':'暂无可推荐标签')+'</div>';
  return html;
}
function bindKbTagAutocomplete(input,popup,mode,onCommit){
  if(!input||!popup) return;
  if(input.dataset.kbAutocompleteBound==='1') return;
  input.dataset.kbAutocompleteBound='1';
  let composing=false;
  const buttons=()=>[...popup.querySelectorAll('[data-kb-suggest]')];
  const setActive=index=>{ const list=buttons(); if(!list.length) return; const next=(index+list.length)%list.length; list.forEach((button,i)=>button.classList.toggle('active',i===next)); };
  const activeIndex=()=>Math.max(0,buttons().findIndex(button=>button.classList.contains('active')));
  const hide=()=>{ popup.hidden=true; };
  const refresh=()=>{
    const ctx=kbTagContext(input);
    if(!ctx){ hide(); return; }
    popup.innerHTML=kbSuggestionHTML(ctx.raw);
    popup.hidden=false;
  };
  const choose=tag=>{
    tag=kbNormTag(tag); if(!tag) return;
    if(mode==='text'){
      const ctx=kbTagContext(input); if(!ctx) return;
      const before=input.value.slice(0,ctx.start), after=input.value.slice(ctx.end);
      input.value=before+'#'+tag+' '+after;
      const caret=before.length+tag.length+2;
      input.focus(); input.setSelectionRange(caret,caret);
    }else{
      input.value=''; input.focus();
    }
    onCommit(tag);
    hide();
  };
  input.addEventListener('compositionstart',()=>{ composing=true; });
  input.addEventListener('compositionend',()=>{ composing=false; refresh(); });
  input.addEventListener('input',()=>{ if(!composing) refresh(); });
  input.addEventListener('focus',refresh);
  input.addEventListener('blur',()=>{ setTimeout(hide,120); });
  input.addEventListener('keydown',event=>{
    const list=buttons(), open=!popup.hidden&&list.length;
    if(open&&(event.key==='ArrowDown'||event.key==='ArrowUp')){ event.preventDefault(); setActive(activeIndex()+(event.key==='ArrowDown'?1:-1)); return; }
    if(event.key==='Escape'&&!popup.hidden){ event.preventDefault(); hide(); return; }
    if(event.key==='Enter'&&!event.shiftKey){
      if(open){ event.preventDefault(); choose(list[activeIndex()].dataset.kbSuggest); return; }
      if(mode==='tags'){
        const tag=kbNormTag(input.value);
        if(tag){ event.preventDefault(); choose(tag); }
      }
    }
    if(event.key==='Tab'&&open){ event.preventDefault(); choose(list[activeIndex()].dataset.kbSuggest); }
  });
  popup.addEventListener('mousedown',event=>{
    const item=event.target.closest('[data-kb-suggest]');
    if(!item) return;
    event.preventDefault(); choose(item.dataset.kbSuggest);
  });
}
function kbTagTree(){
  const roots=[];
  kbAllTags().forEach(tag=>{
    let nodes=roots,path='';
    tag.name.split('/').forEach(part=>{
      path=path?path+'/'+part:part;
      let node=nodes.find(n=>n.name===part);
      if(!node){ node={name:part,path,count:0,children:[]}; nodes.push(node); }
      node.count+=tag.count;
      nodes=node.children;
    });
  });
  const sort=nodes=>{ nodes.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)); nodes.forEach(n=>sort(n.children)); };
  sort(roots); return roots;
}
function kbTreeHTML(nodes,depth){
  return nodes.map(n=>{
    const child=n.children.length>0, open=kbOpenTags.has(n.path)||kbFilter===n.path||kbFilter.startsWith(n.path+'/');
    let h='<div class="kb-tagitem'+(kbFilter===n.path?' on':'')+'" style="padding-left:'+(6+depth*16)+'px"><div class="kb-tree-row">';
    h+=child?'<button class="kb-tree-toggle'+(open?' open':'')+'" data-action="kb-tree-toggle" data-tag="'+esc(n.path)+'" aria-label="展开子标签">›</button>':'<span class="kb-tree-spacer"></span>';
    h+='<span class="kb-tagname" data-action="kb-filter" data-v="'+esc(n.path)+'">#'+esc(n.name)+' <em>'+n.count+'</em></span></div>';
    h+='<span class="kb-tagops"><button class="li-act" data-action="kb-tag-edit" data-tag="'+esc(n.path)+'" title="重命名">'+ic('edit',12)+'</button><button class="li-act" data-action="kb-tag-del" data-tag="'+esc(n.path)+'" title="删除">'+ic('trash',12)+'</button></span></div>';
    if(child&&open) h+=kbTreeHTML(n.children,depth+1);
    return h;
  }).join('');
}
function kbChipsHTML(){
  const tags=kbAllTags();
  if(!tags.length) return '<div class="muted" style="font-size:12px">还没有标签，可在左侧「全部标签」新建。</div>';
  return tags.map(t=>'<button type="button" class="kb-chip'+(kbSelTags.has(t.name)?' on':'')+'" data-action="kb-tag-toggle" data-tag="'+esc(t.name)+'">'+esc(t.name)+'</button>').join('');
}
function kmDay(iso){ if(!iso) return ''; const d=new Date(iso.includes('T')?iso:iso+'T00:00:00'); if(isNaN(d)) return iso; return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function kbSearchNorm(value){
  let s=String(value||'');
  if(s.normalize) s=s.normalize('NFKC');
  return s.toLocaleLowerCase('zh-CN').replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
}
function kbSearchTerms(){ return kbSearchNorm(kbQuery).split(/\s+/).map(x=>x.replace(/^#+/,'')).filter(Boolean); }
function kbFilteredKnowledge(){
  if(kbFocusId) return S.knowledge.filter(k=>k.id===kbFocusId);
  const terms=kbSearchTerms();
  return S.knowledge.filter(k=>{
    const tags=(k.tags||[]).map(kbNormTag);
    const hay=kbSearchNorm(k.text+' '+tags.join(' ')+' '+tags.map(t=>'#'+t).join(' '));
    return (kbFilter==='all'||tags.some(t=>t===kbFilter||t.startsWith(kbFilter+'/'))) && terms.every(term=>hay.includes(term)) && (kbSort!=='favorite'||k.favorite);
  }).slice().sort((a,b)=>{
    if(kbSort==='oldest') return (a.created||'').localeCompare(b.created||'');
    if(kbSort==='review') return (a.lastReviewed||a.created||'').localeCompare(b.lastReviewed||b.created||'');
    return (b.created||'').localeCompare(a.created||'');
  });
}
function kbFeedHTML(){
  const terms=kbSearchTerms(), filtered=kbFilteredKnowledge(), list=filtered.slice(0,kbLimit);
  let h='';
  if(kbFocusId) h+='<div class="kb-focus-bar"><span>已定位到阅读引用的卡片</span><button class="btn ghost sm" data-action="kb-focus-clear">返回全部笔记</button></div>';
  if(!list.length) h+='<div class="empty">'+(terms.length?'没有找到匹配的卡片。可以减少关键词，或直接输入 #标签。':'还没有知识碎片，上面记一条吧。')+'</div>';
  list.forEach(k=>{
    if(k.id===kbEditingId){ h+=kbEditCardHTML(k); return; }
    h+='<div class="kb-card'+(k.id===kbFocusId?' kb-card-focused':'')+'" data-card-id="'+esc(k.id)+'"><div class="kb-top">'
      + '<span class="kb-time">'+esc(kmDay(k.created))+'</span>'
      + '<span class="kb-ops always">'
      +   '<button class="li-act'+(k.favorite?' on':'')+'" data-action="kb-favorite" data-id="'+esc(k.id)+'" title="'+(k.favorite?'取消收藏':'收藏')+'">'+ic('star',14)+'</button>'
      +   '<button class="li-act" data-action="kb-edit" data-id="'+esc(k.id)+'" title="编辑">'+ic('edit',14)+'</button>'
      +   '<button class="li-act" data-action="kb-del" data-id="'+esc(k.id)+'" title="删除">'+ic('trash',14)+'</button>'
      + '</span></div>'
      + ((k.tags&&k.tags.length)?('<div class="kb-tags">'+k.tags.map(tg=>'<span class="tag link" data-action="kb-filter" data-v="'+esc(tg)+'">#'+esc(tg)+'</span>').join('')+'</div>'):'')
      + '<div class="kb-text">'+esc(k.text).replace(/\n/g,'<br>')+'</div>'
      + '<div class="kb-card-foot">'+(k.reviewCount?'<span class="kb-review-count">温故 '+k.reviewCount+' 次</span>':'')+'</div></div>';
  });
  if(filtered.length>list.length) h+='<button class="btn ghost" data-action="kb-more">再看 '+Math.min(30,filtered.length-list.length)+' 条，还剩 '+(filtered.length-list.length)+' 条</button>';
  return h;
}
function kbEditCardHTML(k){
  return '<article class="kb-card kb-card-editing" data-kb-editor data-id="'+esc(k.id)+'">'
    + '<div class="kb-edit-head"><div><span class="kb-time">'+esc(kmDay(k.created))+'</span><b>正在编辑</b></div><span>在卡片内修改，阅读上下文不会消失</span></div>'
    + '<div class="kb-inline-body-wrap"><textarea class="kb-inline-text" aria-label="编辑卡片内容">'+esc(k.text)+'</textarea><div class="kb-tag-suggest" data-kb-text-suggest hidden></div></div>'
    + '<div class="kb-inline-tag-section"><label>标签</label><div class="kb-edit-tag-chips" data-kb-edit-chips>'+kbTagChipsHTML(kbEditTags,'kb-edit-tag-remove')+'</div>'
    + '<div class="kb-inline-tag-wrap"><input class="kb-inline-tag-input" aria-label="添加分级标签" placeholder="输入 #标签/子标签，按回车添加"><div class="kb-tag-suggest" data-kb-field-suggest hidden></div></div></div>'
    + '<div class="kb-inline-actions"><span>输入 # 查看推荐，输入 / 继续选择子标签</span><div><button class="btn ghost sm" data-action="kb-edit-cancel" data-id="'+esc(k.id)+'">取消</button><button class="btn primary sm" data-action="kb-edit-save" data-id="'+esc(k.id)+'">保存修改</button></div></div></article>';
}
function kbRefreshEditChips(){
  const card=document.querySelector('[data-kb-editor]');
  const row=card&&card.querySelector('[data-kb-edit-chips]');
  if(row) row.innerHTML=kbTagChipsHTML(kbEditTags,'kb-edit-tag-remove');
}
function kbRefreshComposeChips(){
  const row=document.getElementById('kb-compose-selected');
  if(!row) return;
  row.innerHTML=kbTagChipsHTML(kbSelTags,'kb-compose-tag-remove');
  row.classList.toggle('empty',kbSelTags.size===0);
}
function bindKnowledgeEditors(){
  const composeInput=document.getElementById('kb-tag-input');
  const composePopup=document.querySelector('[data-kb-compose-suggest]');
  bindKbTagAutocomplete(composeInput,composePopup,'tags',tag=>{ kbSelTags.add(tag); kbRefreshComposeChips(); });
  const card=document.querySelector('[data-kb-editor]');
  if(!card) return;
  const text=card.querySelector('.kb-inline-text');
  const tagInput=card.querySelector('.kb-inline-tag-input');
  bindKbTagAutocomplete(text,card.querySelector('[data-kb-text-suggest]'),'text',tag=>{ kbEditTags.add(tag); kbRefreshEditChips(); });
  bindKbTagAutocomplete(tagInput,card.querySelector('[data-kb-field-suggest]'),'tags',tag=>{ kbEditTags.add(tag); kbRefreshEditChips(); });
  setTimeout(()=>{ text.focus(); text.setSelectionRange(text.value.length,text.value.length); },0);
}
function viewKnowledge(){
  const tags=kbAllTags();
  const tagPaths=new Set();
  tags.forEach(t=>{ const parts=t.name.split('/'); for(let i=1;i<=parts.length;i++) tagPaths.add(parts.slice(0,i).join('/')); });
  const dates=S.knowledge.map(k=>new Date(k.created||'')).filter(d=>!isNaN(d));
  const oldest=dates.length?new Date(Math.min(...dates.map(d=>d.getTime()))):new Date();
  const days=Math.max(1,Math.floor((todayMid().getTime()-new Date(oldest.getFullYear(),oldest.getMonth(),oldest.getDate()).getTime())/86400000)+1);
  let h='<div class="page-head"><div class="page-title">知识库</div><div class="page-desc">随手记录想法，按标签整理，随时找回。</div></div>';
  h+='<div class="kb-wrap">';

  /* —— 左栏：统计 + 热力图 + 全部标签（可增删改） —— */
  h+='<div class="kb-side">';
  h+='<div class="kb-stats">'
    + '<div class="kb-stat"><b>'+S.knowledge.length+'</b><span>笔记</span></div>'
    + '<div class="kb-stat"><b>'+tagPaths.size+'</b><span>标签</span></div>'
    + '<div class="kb-stat"><b>'+days+'</b><span>天</span></div></div>';
  h+='<div class="kb-tools"><div class="search-lite">'+ic('search',15)+'<input id="kb-search" value="'+esc(kbQuery)+'" placeholder="搜索卡片内容或标签"></div><select id="kb-sort" aria-label="卡片排序"><option value="newest"'+(kbSort==='newest'?' selected':'')+'>最新记录</option><option value="oldest"'+(kbSort==='oldest'?' selected':'')+'>最早记录</option><option value="review"'+(kbSort==='review'?' selected':'')+'>优先温故</option><option value="favorite"'+(kbSort==='favorite'?' selected':'')+'>只看收藏</option></select></div>';
  h+='<div class="kb-tagbar">'
    + '<div class="kb-taghead"><span class="kb-all'+(kbFilter==='all'?' on':'')+'" data-action="kb-filter" data-v="all">全部标签</span>'
    + '<button class="li-act" data-action="kb-tag-add" title="新建标签">'+ic('plus',13)+'</button></div>'
    + '<div class="kb-taglist">';
  if(!tags.length) h+='<div class="muted" style="font-size:12px;padding:2px 4px">暂无标签</div>';
  h+=kbTreeHTML(kbTagTree(),0);
  h+='</div></div>';
  h+='</div>'; /* kb-side */

  /* —— 右栏：记录输入 + 笔记流 —— */
  h+='<div class="kb-main">';
  h+='<div class="kb-compose">'
    + '<textarea id="kb-in" placeholder="现在的想法是…" rows="3"></textarea>'
    + '<div class="kb-compose-selected'+(kbSelTags.size?'':' empty')+'" id="kb-compose-selected">'+kbTagChipsHTML(kbSelTags,'kb-compose-tag-remove')+'</div>'
    + '<div class="kb-compose-foot"><div class="kb-compose-tag-wrap"><input class="kb-tag-input" id="kb-tag-input" placeholder="输入 #标签/子标签，按回车添加"><div class="kb-tag-suggest" data-kb-compose-suggest hidden></div></div>'
    +   '<button class="kb-send" data-action="kb-add" title="记录知识">'+ic('send',15)+'<span>记录</span></button></div></div>';

  h+='<div class="kb-feed" id="kb-feed">'+kbFeedHTML()+'</div>';
  h+='</div>'; /* kb-main */
  h+='</div>'; /* kb-wrap */
  return h;
}

/* ---------------- STATISTICS ---------------- */
function checkinTypeCounts(){
  const m={}; CHECKIN_DEFS.forEach(c=>m[c.k]=0);
  Object.keys(S.checkins).forEach(d=>{ const rec=S.checkins[d]||{}; CHECKIN_DEFS.forEach(c=>{ if(rec[c.k]) m[c.k]++; }); });
  return m;
}
function dailyCheckinCounts(n){
  const out=[]; for(let i=n-1;i>=0;i--){ const d=addDaysISO(todayISO(),-i); const rec=S.checkins[d]||{}; let c=0; CHECKIN_DEFS.forEach(x=>{ if(rec[x.k]) c++; }); out.push({d:d,c:c}); } return out;
}
function miniBarChart(data, color){
  const max=Math.max(1,...data.map(x=>x.c));
  const labs=['日','一','二','三','四','五','六'];
  return '<div class="checkin-bars">'+data.map(x=>'<div class="checkin-day"><b>'+x.c+'</b><span class="checkin-bar"><i style="height:'+Math.max(5,Math.round(x.c/max*76))+'%"></i></span><small>'+labs[new Date(x.d+'T00:00:00').getDay()]+'</small></div>').join('')+'</div>';
}
function monthCheckinHTML(){
  const year=checkinMonthCursor.getFullYear(), month=checkinMonthCursor.getMonth();
  const offset=(new Date(year,month,1).getDay()+6)%7;
  const count=new Date(year,month+1,0).getDate();
  const monthFirst=isoLocal(new Date(year,month,1)),monthLast=isoLocal(new Date(year,month,count));
  const shown=(S.habits||[]).filter(c=>{
    if(!c.archivedAt) return !c.createdAt||c.createdAt<=monthLast;
    return Object.keys(S.checkins||{}).some(d=>d>=monthFirst&&d<=monthLast&&!!S.checkins[d]?.[c.k]);
  });
  let recorded=0, completed=0;
  let cells='<div class="month-weekdays">'+['一','二','三','四','五','六','日'].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="month-grid">';
  for(let i=0;i<offset;i++) cells+='<span class="month-pad" aria-hidden="true"></span>';
  for(let day=1;day<=count;day++){
    const date=isoLocal(new Date(year,month,day));
    const rec=S.checkins[date]||{};
    const eligible=(S.habits||[]).filter(c=>habitAt(c,date));
    const dayHabits=shown.filter(c=>c.archivedAt?!!rec[c.k]:habitAt(c,date));
    const active=dayHabits.filter(c=>!!rec[c.k]);
    const mood=S.moods[date]||'';
    if(active.length||mood) recorded++;
    completed+=active.length;
    const full=eligible.length>0&&eligible.every(c=>rec[c.k]);
    const label=(month+1)+'月'+day+'日：'+(mood?'心情'+MOOD_META[mood]?.label+'；':'')+(active.length?active.map(c=>c.l).join('、'):'未打卡');
    cells+='<div class="month-day'+(date===todayISO()?' today':'')+(full?' full':'')+'" title="'+esc(label)+'" aria-label="'+esc(label)+'"><span class="month-date">'+day+'</span><span class="month-mood" style="--mood-color:'+(MOOD_META[mood]?.color||'transparent')+'">'+(MOOD_META[mood]?mood:'')+'</span><span class="month-dots">'+dayHabits.map(c=>'<i style="'+habitStyle(c)+'" class="'+(rec[c.k]?'on':'')+'" title="'+esc(c.l)+'"></i>').join('')+'</span></div>';
  }
  cells+='</div>';
  return '<div class="month-checkin"><div class="month-checkin-head"><div><b>'+year+' 年 '+(month+1)+' 月打卡记录</b><span>圆点颜色对应习惯；全部完成的日期会加深</span></div><div class="month-nav"><button class="icon-btn" data-action="checkin-month-prev" aria-label="上个月">'+ic('chevL',16)+'</button><button class="icon-btn" data-action="checkin-month-next" aria-label="下个月">'+ic('chevR',16)+'</button></div></div>'+cells+'<div class="month-checkin-foot"><span class="month-summary">'+recorded+' 天有记录 · '+completed+' 次打卡</span><div class="month-legend">'+shown.map(c=>'<span style="'+habitStyle(c)+'"><i></i>'+esc(c.l)+'</span>').join('')+'</div></div></div>';
}
function viewStats(){
  const total=S.tasks.length, done=S.tasks.filter(t=>t.completed).length, over=S.tasks.filter(t=>isOverdue(t)).length;
  const ws=weekTaskStats();
  const tc=checkinTypeCounts();
  let h='<div class="page-head"><div class="page-title">数据</div><div class="page-desc">任务、习惯与项目的实际进展。</div></div>';

  /* —— 任务篇：一个分析卡片，左叙事文本，右数字面板 —— */
  h+=sectionTitle('list','任务节奏');
  h+='<div class="stats-row">'
    + '<div class="stats-cell">'
    +   '<div class="stats-cell-h">这周完成情况</div>'
    +   '<div class="stats-cell-b">本周安排 '+ws.total+' 项，完成 '+ws.done+' 项，当前完成率 '+ws.pct+'%。</div>'
    +   '<div class="stats-pills">'
    +     '<span class="stats-pill"><b>'+done+'</b><i>/ '+total+'</i><em>已完成</em></span>'
    +     '<span class="stats-pill warn"><b>'+over+'</b><i>&nbsp;</i><em>逾期</em></span>'
    +   '</div>'
    + '</div>'
    + '<div class="stats-cell">'
    +   '<div class="stats-cell-h">连续打卡</div>'
    +   '<div class="stats-cell-b">当前已连续记录 '+checkinStreak()+' 天。</div>'
    +   '<div class="bar mt"><i style="width:'+Math.min(100,checkinStreak()/14*100)+'%;background:var(--green)"></i></div>'
    +   '<div class="stats-meta">目标 14 天</div>'
    + '</div>'
    + '</div>';

  /* 打卡：趋势与类型使用一个连续面板，避免两张不等高卡片 */
  h+=sectionTitle('activity','打卡');
  h+='<div class="stats-checkin-panel"><div class="checkin-trend">'+monthCheckinHTML()+'</div>'
    + '<div class="checkin-types"><div class="stats-cell-h">累计次数</div><div class="ck-tally">'
    + CHECKIN_DEFS.map(c=>'<div class="ck-tally-row" style="'+habitStyle(c)+'"><span class="ck-tally-e">'+checkinIcon(c,17)+'</span><span class="ck-tally-l">'+esc(c.l)+'</span><b>'+tc[c.k]+'</b></div>').join('')
    + '</div></div></div>';

  /* —— 项目篇：每个项目一行进度带 —— */
  h+=sectionTitle('target','项目进度');
  h+='<div class="stats-list">';
  PROJ_ORDER.forEach(p=>{ const P=PROJECTS[p], pr=projProgress(p);
    h+='<div class="stats-list-row" data-project="'+esc(p)+'" style="--project-color:'+esc(P.color)+'"><span class="proj-ico">'+projectIcon(P,18)+'</span>'
      + '<div class="stats-list-body"><div class="stats-list-h"><span>'+esc(P.name)+'</span><b>'+pr+'%</b></div>'
      + '<div class="bar mt"><i style="width:'+pr+'%"></i></div></div>'
      + '<div class="stats-list-meta">'+projCount(p)+'</div></div>';
  });
  h+='</div>';

  /* —— 优先级与资源 —— */
  const byP={high:0,medium:0,low:0}; S.tasks.filter(t=>!t.completed).forEach(t=>byP[t.priority]++);
  h+=sectionTitle('flag','未完成优先级');
  h+='<div class="stats-row">'
    + '<div class="stats-cell">'
    +   '<div class="stats-cell-h">堆积形状</div>'
    +   '<div class="stats-cell-b">按优先级查看当前未完成任务。</div>'
    +   '<div class="pri-bars">'
    +     Object.entries(byP).map(([k,v])=>'<div class="pri-bar"><span class="pri-k" style="color:'+PRIORITY[k].color+'">'+PRIORITY[k].label+'</span><span class="pri-bar-bg"><i style="width:'+(v?Math.min(100,(v/Math.max(1,byP.high+byP.medium+byP.low))*100):0)+'%;background:'+PRIORITY[k].color+'"></i></span><b class="nums">'+v+'</b></div>').join('')
    +   '</div>'
    + '</div>'
    + '<div class="stats-cell">'
    +   '<div class="stats-cell-h">本周复盘建议</div>'
    +   '<div class="stats-cell-b">'+(over?'优先处理 '+over+' 项逾期任务。':(ws.total===0?'本周还没有安排任务，可以先添加 1-3 个明确行动。':(ws.pct<60?'下周减少同时推进的任务，为重点事项留出完整时间。':'当前节奏稳定，下周继续保留必要缓冲。')))+'</div>'
    +   '<div class="review-summary"><span><b>'+S.knowledge.length+'</b> 张知识卡片</span><span><b>'+S.knowledge.filter(k=>k.lastReviewed).length+'</b> 张已温故</span><span><b>'+checkinStreak()+'</b> 天连续打卡</span></div>'
    + '</div>'
    + '</div>';
  return h;
}

/* ---------------- SETTINGS ---------------- */
const PALETTE_OPTIONS=[
  {key:'calm',label:'清新蓝灰',colors:['#244b5a','#e1eceb','#ffffff']},
  {key:'yellow',label:'柔光黄色',colors:['#806018','#f3d66f','#fff8db']},
  {key:'purple',label:'雾感紫色',colors:['#674b93','#cdb7ea','#f2ecfa']},
  {key:'blue',label:'晴空蓝色',colors:['#315f8f','#acd0ee','#e8f4ff']},
  {key:'pink',label:'柔雾粉色',colors:['#984c6d','#efb8cc','#fcebf2']},
  {key:'yellow-purple',label:'黄紫拼色',colors:['#edc443','#8b62bc','#fff3b5']},
  {key:'pink-blue',label:'粉蓝拼色',colors:['#ed8db0','#5d9fd1','#fde4ee']}
];
function paletteChoiceHTML(option){
  const selected=(S.settings.palette||'calm')===option.key;
  return '<button type="button" class="palette-choice'+(selected?' on':'')+'" data-action="palette-set" data-v="'+option.key+'" aria-pressed="'+(selected?'true':'false')+'">'
    + '<span class="palette-swatches">'+option.colors.map(color=>'<i style="background:'+color+'"></i>').join('')+'</span><span>'+option.label+'</span>'+(selected?ic('check',14):'<span class="palette-check-space"></span>')+'</button>';
}
function viewSettings(){
  const storageKb=Math.max(1,Math.round(JSON.stringify(S).length/1024));
  let h='<div class="page-head"><div class="page-title">设置</div><div class="page-desc">调整你的项目、习惯和界面，查看数据保存位置。</div></div>';

  /* —— 身份 —— */
  h+='<div class="settings-card"><div class="settings-h">身份</div><div class="settings-b">';
  h+='<div class="field"><label>显示名称（可选）</label><input id="set-name" value="'+esc(S.settings.name)+'" placeholder="例如：小雨"></div>';
  h+='</div></div>';

  h+='<div class="settings-card"><div class="settings-h">项目与打卡</div><div class="settings-b"><p class="muted">名称和颜色会同步到各个页面。删除项目时，其任务会移到另一个项目；删除打卡不会清除历史记录。</p>';
  h+='<div class="manage-list-head"><b>项目</b><button class="btn ghost sm" data-action="project-add">'+ic('plus',13)+' 新增</button></div><div class="manage-list">'
    +PROJ_ORDER.map(k=>{const p=PROJECTS[k];return '<div class="manage-row" style="--item-color:'+esc(p.color)+'"><span class="manage-swatch"></span><span>'+esc(p.name)+'</span><button class="btn ghost tiny" data-action="project-edit" data-key="'+esc(k)+'">编辑</button><button class="btn ghost tiny" data-action="project-delete" data-key="'+esc(k)+'">删除</button></div>';}).join('')+'</div>';
  h+='<div class="manage-list-head"><b>打卡</b><button class="btn ghost sm" data-action="habit-add">'+ic('plus',13)+' 新增</button></div><div class="manage-list">'
    +CHECKIN_DEFS.map(c=>'<div class="manage-row" style="--item-color:'+esc(c.color)+'"><span class="manage-swatch"></span><span>'+esc(c.l)+'</span><button class="btn ghost tiny" data-action="habit-edit" data-key="'+esc(c.k)+'">编辑</button><button class="btn ghost tiny" data-action="habit-delete" data-key="'+esc(c.k)+'">删除</button></div>').join('')+'</div></div></div>';

  h+='<div class="settings-card"><div class="settings-h">'+(remoteSync.mode==='local'?'电脑存储':'数据存储与同步')+'</div><div class="settings-b">'
    +'<p class="sync-status">'+esc(remoteSync.status)+'</p>';
  if(remoteSync.mode==='local'){
    h+='<p>无需注册，任务、笔记、习惯和设置自动保存在这台电脑。</p><p class="muted" style="overflow-wrap:anywhere">数据文件：'+esc(remoteSync.dataPath)+'</p>';
    if(remoteSync.conflict) h+='<div class="sync-conflict"><p>浏览器和数据库有不同版本。先导出当前内容备份，再选择要保留的版本。</p><button class="btn" data-action="sync-use-cloud">读取电脑数据库</button><button class="btn" data-action="sync-use-local">保留当前浏览器内容</button></div>';
  }else if(remoteSync.user){
    h+='<p class="muted">当前账号：'+esc(remoteSync.user.email)+'</p>';
    if(remoteSync.conflict) h+='<div class="sync-conflict"><p>两份数据不能自动合并。先导出本机 JSON 备份，再选择要保留的版本。</p><button class="btn" data-action="sync-use-cloud">使用云端数据</button><button class="btn" data-action="sync-use-local">使用本机数据</button></div>';
    h+='<button class="btn ghost sm" data-action="sync-logout">退出账号</button>';
  }else if(remoteSync.available){
    h+='<div class="sync-form"><input id="sync-email" type="email" autocomplete="username" placeholder="邮箱"><input id="sync-password" type="password" autocomplete="current-password" placeholder="密码（注册至少 12 个字符）"><button class="btn primary" data-action="sync-login">登录并同步</button><button class="btn ghost" data-action="sync-register">创建账号</button></div>';
  }else h+='<p class="muted">如需手机与电脑同步，请通过运行同步服务的同一个网址打开 Dayloom。仅打开 HTML 文件或 GitHub Pages 时仍可本地使用。</p>';
  if(!remoteSync.available&&location.protocol!=='file:') h+='<button class="btn" data-action="storage-retry">重新连接本机服务</button>';
  h+='</div></div>';

  /* —— AI 服务 —— */
  h+='<div class="settings-card"><div class="settings-h">AI 阅读</div><div class="settings-b">';
  if(aiService.available){
    h+='<div class="ai-settings-grid"><div class="field"><label>API 地址</label><input id="ai-base-url" type="url" value="'+esc(aiService.baseUrl)+'" placeholder="https://example.com/v1"></div><div class="field"><label>模型名称</label><input id="ai-model" value="'+esc(aiService.model)+'" placeholder="模型名称"></div><div class="field ai-key-field"><label>API Key</label><input id="ai-api-key" type="password" autocomplete="off" placeholder="'+(aiService.hasKey?'已保存，留空则不修改':'本地模型可以留空')+'"></div></div>'
      +'<div class="settings-actions"><button class="btn primary" data-action="ai-save">保存设置</button>'+(aiService.configured?'<button class="btn" data-action="ai-test">测试连接</button><button class="btn ghost" data-action="ai-clear">清除</button>':'')+'</div><p class="muted ai-privacy-note">生成前会显示将要发送的卡片；API Key 只保存在这台电脑，不进入 JSON 备份。</p>';
  }else h+='<p class="muted">通过本机服务地址打开后，可配置兼容的 AI 接口。直接打开 HTML 时仍可使用“今日重读”。</p>';
  h+='</div></div>';

  /* —— 主题 —— */
  h+='<div class="settings-card"><div class="settings-h">主题</div><div class="settings-b">';
  h+='<div class="field"><label>颜色模式</label><div class="seg" style="width:auto">'
    + '<button data-action="theme-set" data-v="light" class="'+(S.settings.theme!=='dark'?'on':'')+'">'+ic('sun',14)+' 亮色</button>'
    + '<button data-action="theme-set" data-v="dark" class="'+(S.settings.theme==='dark'?'on':'')+'">'+ic('moon',14)+' 暗色</button></div></div>';
  h+='<div class="field palette-field"><label>界面配色</label><p>每次只启用一套色系，内容和功能不会变化。</p><div class="palette-grid">'+PALETTE_OPTIONS.map(paletteChoiceHTML).join('')+'</div></div>';
  h+='</div></div>';

  /* —— 数据 —— */
  h+='<div class="settings-card"><div class="settings-h">本地数据</div><div class="settings-b"><div class="storage-health"><span class="storage-icon">'+ic('download',18)+'</span><div><b>已保存 '+S.knowledge.length+' 张知识卡片</b><p>当前数据约 '+storageKb+' KB · 建议每周导出一次备份</p></div></div>';
  h+='<div class="settings-actions">'
    + '<button class="btn" data-action="export">'+ic('arrow',14)+' 导出 JSON</button>'
    + '<button class="btn" data-action="import">'+ic('arrow',14)+' 导入 JSON</button>'
    + '<button class="btn destructive" data-action="reset-demo">'+ic('trash',14)+' 清空全部数据</button></div>';
  h+='<p class="muted" style="font-size:12px;margin-top:12px">请定期导出 JSON 备份。直接双击 HTML 与通过服务网址访问，浏览器会视为两个不同的本地存储空间。</p>';
  h+='</div></div>';

  return h;
}

/* ---------------- MODALS / FORMS ---------------- */
const modalRoot=document.getElementById('modal-root');
function closeModal(){ modalRoot.innerHTML=''; }
function openForm(title, fields, values, onSave){
  let html='<div class="overlay" data-overlay><div class="modal"><h3>'+esc(title)+'</h3>';
  fields.forEach(f=>{
    let v=(values&&values[f.name]!=null)?values[f.name]:'';
    if(f.type==='checklist') v=Array.isArray(v)?v:[];
    if(f.type==='chips') v=Array.isArray(v)?v:[];
    html+='<div class="field"><label>'+esc(f.label)+'</label>';
    if(f.type==='textarea') html+='<textarea data-f="'+f.name+'">'+esc(v)+'</textarea>';
    else if(f.type==='select') html+='<select data-f="'+f.name+'">'+f.options.map(o=>'<option value="'+esc(o.value)+'"'+(String(o.value)===String(v)?' selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select>';
    else if(f.type==='date') html+='<input type="date" data-f="'+f.name+'" value="'+esc(v)+'">';
    else if(f.type==='color') html+='<input type="color" data-f="'+f.name+'" value="'+esc(v)+'">';
    else if(f.type==='number') html+='<input type="number" data-f="'+f.name+'" value="'+esc(v)+'">';
    else if(f.type==='chips') html+='<div class="chips" data-f="'+f.name+'">'+(f.options&&f.options.length?f.options.map(o=>'<button type="button" class="kb-chip'+(v.includes(o.value)?' on':'')+'" data-chip="'+esc(o.value)+'"'+(v.includes(o.value)?' data-on="1"':'')+'>'+esc(o.label)+'</button>').join(''):'<div class="muted" style="font-size:12px">暂无标签，先到左栏「全部标签」新建。</div>')+'</div>';
    else html+='<input type="text" data-f="'+f.name+'" value="'+esc(v)+'">';
    html+='</div>';
  });
  html+='<div class="modal-foot"><button class="btn ghost" data-overlay-close>取消</button><button class="btn primary" data-form-save>保存</button></div></div></div>';
  modalRoot.innerHTML=html;
  /* chips 点击切换 */
  modalRoot.querySelectorAll('.chips').forEach(ch=>{
    ch.addEventListener('click',e=>{
      const chip=e.target.closest('[data-chip]'); if(!chip) return;
      const on=chip.getAttribute('data-on')==='1';
      chip.setAttribute('data-on', on?'0':'1');
      chip.classList.toggle('on', !on);
    });
  });
  modalRoot.querySelector('[data-form-save]').onclick=()=>{
    const vals={}; fields.forEach(f=>{
      const el=modalRoot.querySelector('[data-f="'+f.name+'"]');
      if(f.type==='chips') vals[f.name]=[...el.querySelectorAll('.kb-chip[data-on="1"]')].map(c=>c.getAttribute('data-chip'));
      else vals[f.name]=el?el.value:'';
    });
    if(onSave(vals)===false) return;
    closeModal(); render();
  };
}
function openProjectForm(key){
  const p=key?PROJECTS[key]:null;
  openForm(p?'编辑项目':'新增项目',[
    {name:'name',label:'项目名称',type:'text',value:p?.name||''},
    {name:'color',label:'识别颜色',type:'color',value:p?.color||'#4e8290'}
  ],p||{},v=>{
    const name=v.name.trim();
    if(!name){toast('请填写项目名称');return false;}
    if(S.projects.some(x=>x.key!==key&&x.name===name)){toast('已有同名项目');return false;}
    if(p){p.name=name;p.short=name.slice(0,4);p.color=v.color;}
    else S.projects.push({key:uid('p'),name,short:name.slice(0,4),en:'',icon:'target',color:v.color});
    hydrateDefinitions();save();toast(p?'项目已更新':'项目已添加');
  });
}
function deleteProject(key){
  const p=PROJECTS[key];if(!p)return;
  if(PROJ_ORDER.length<2){toast('至少保留一个项目');return;}
  const fallback=S.projects.find(x=>x.key!==key);
  const count=S.tasks.filter(t=>t.project===key).length;
  if(!confirm('删除「'+p.name+'」？'+(count?'其中 '+count+' 项任务会移到「'+fallback.name+'」。':'')))return;
  S.tasks.forEach(t=>{if(t.project===key)t.project=fallback.key;});
  S.projects=S.projects.filter(x=>x.key!==key);
  hydrateDefinitions();save();render();toast('项目已删除，任务已保留');
}
function openHabitForm(key){
  const habit=key?S.habits.find(c=>c.k===key&&!c.archivedAt):null;
  openForm(habit?'编辑打卡':'新增打卡',[
    {name:'name',label:'打卡名称',type:'text',value:habit?.l||''},
    {name:'emoji',label:'表情',type:'text',value:habit?.emoji||'✨'},
    {name:'color',label:'圆点颜色',type:'color',value:habit?.color||HABIT_COLORS[CHECKIN_DEFS.length%HABIT_COLORS.length]}
  ],{name:habit?.l||'',emoji:habit?.emoji||'✨',color:habit?.color||HABIT_COLORS[CHECKIN_DEFS.length%HABIT_COLORS.length]},v=>{
    const name=v.name.trim();
    if(!name){toast('请填写打卡名称');return false;}
    if(CHECKIN_DEFS.some(c=>c.k!==key&&c.l===name)){toast('已有同名打卡');return false;}
    const emoji=v.emoji.trim().slice(0,8)||'✨';
    if(habit){habit.l=name;habit.color=v.color;habit.emoji=emoji;}
    else S.habits.push({k:uid('h'),l:name,icon:'check',emoji,color:v.color,createdAt:todayISO(),archivedAt:null});
    hydrateDefinitions();save();toast(habit?'打卡已更新':'打卡已添加');
  });
}
function deleteHabit(key){
  const c=S.habits.find(x=>x.k===key&&!x.archivedAt);if(!c)return;
  if(!confirm('删除「'+c.l+'」？过去的打卡记录会继续保留在月份视图里。'))return;
  c.archivedAt=addDaysISO(todayISO(),1);
  hydrateDefinitions();save();render();toast('已删除打卡，历史记录保留');
}
function openTaskForm(t){
  const isNew=!t; t=t||{project:projFilter==='all'?PROJ_ORDER[0]:projFilter,priority:'medium',status:'backlog',due:'',time:'',estimate:'',knowledgeId:'',notes:''};
  openForm(isNew?'新任务':'编辑任务',[
    {name:'title',label:'标题',type:'text'},
    {name:'project',label:'项目',type:'select',options:PROJ_ORDER.map(p=>({value:p,label:PROJECTS[p].name})),value:t.project},
    {name:'priority',label:'优先级',type:'select',options:[{value:'high',label:'高'},{value:'medium',label:'中'},{value:'low',label:'低'}],value:t.priority},
    {name:'status',label:'状态',type:'select',options:BOARD_COLS.map(c=>({value:c.key,label:c.label})),value:(t.status==='todo'?'backlog':t.status)},
    {name:'due',label:'截止日期',type:'date',value:t.due},
    {name:'time',label:'时间（可选）',type:'text',value:t.time},
    {name:'estimate',label:'预计用时（分钟）',type:'number',value:t.estimate||''},
    {name:'knowledgeId',label:'关联知识卡片',type:'select',options:[{value:'',label:'不关联'}].concat((S.knowledge||[]).slice(0,100).map(k=>({value:k.id,label:compactText(k.text,42)}))),value:t.knowledgeId||''},
    {name:'notes',label:'备注',type:'textarea',value:t.notes}
  ], t, (v)=>{
    v.estimate=+v.estimate||0;
    if(isNew){ S.tasks.push({id:uid('t'),title:v.title,project:v.project,priority:v.priority,status:v.status,due:v.due,time:v.time,estimate:v.estimate,knowledgeId:v.knowledgeId,completed:v.status==='done',notes:v.notes}); }
    else { const x=S.tasks.find(z=>z.id===t.id); Object.assign(x,v); x.completed=v.status==='done'; }
    save(); toast(isNew?'已添加任务':'已更新任务');
  });
}
function openSearch(){
  let html='<div class="overlay" data-overlay><div class="modal" style="max-width:600px"><h3>'+ic('search',18)+' 搜索</h3>'
    + '<input id="search-input" placeholder="搜索任务 / 知识..." style="width:100%;padding:10px 12px;border:1px solid var(--line-2);border-radius:10px;margin-bottom:14px">'
    + '<div id="search-results" style="max-height:55vh;overflow-y:auto"></div></div></div>';
  modalRoot.innerHTML=html;
  const inp=modalRoot.querySelector('#search-input'); inp.focus();
  inp.addEventListener('input',()=>{ modalRoot.querySelector('#search-results').innerHTML=searchResults(inp.value); });
  modalRoot.querySelector('#search-results').innerHTML=searchResults('');
}
function searchResults(q){
  q=q.trim().toLowerCase(); if(!q) return '<div class="muted" style="padding:10px">输入关键词，搜索任务与本地知识卡片。</div>';
  const groups={};
  const add=(g,icon,title,sub,action)=>{ (groups[g]=groups[g]||[]).push({icon,title,sub,action}); };
  S.tasks.forEach(t=>{ if((t.title+' '+PROJECTS[t.project].name).toLowerCase().includes(q))
    add('任务',PROJECTS[t.project].icon,t.title,PROJECTS[t.project].name+' / '+(TASK_STATUS_LABEL[t.status]||t.status),'data-action="edit" data-kind="task" data-id="'+t.id+'"'); });
  (S.knowledge||[]).forEach(k=>{ if((k.text+' '+((k.tags||[]).join(' ')||k.tag||'')).toLowerCase().includes(q.replace(/^#+/,''))) add('知识','brain',k.text.slice(0,56),((k.tags||[]).join(' ')||k.tag||''),'data-action="kb-open" data-id="'+k.id+'"'); });
  if(Object.keys(groups).length===0) return '<div class="muted" style="padding:10px">没有匹配「'+esc(q)+'」的结果。</div>';
  let h='';
  Object.entries(groups).forEach(([g,items])=>{
    h+='<div class="sr-group"><h4>'+g+' ('+items.length+')</h4>';
    items.slice(0,8).forEach(it=>{ h+='<div class="list-item" '+(it.action||'')+' style="cursor:pointer">'+projBadge2(it.icon)+'<div class="li-body"><div class="li-title">'+esc(it.title)+'</div><div class="li-meta">'+esc(it.sub)+'</div></div>'+ic('chevron',16)+'</div>'; });
    h+='</div>';
  });
  return h;
}
function projBadge2(icon){ return '<div class="search-result-icon">'+ic(icon,17)+'</div>'; }

/* ---------------- EVENT HANDLING ---------------- */
function setView(v,arg){
  view=v; viewArg=arg; qaOpen=false;
  scrollReset=true;
  render();
  const m=document.getElementById('main'); if(m) m.scrollTop=0;
  const se=document.scrollingElement||document.documentElement; if(se) se.scrollTop=0;
}
function onClick(e){
  if(e.target.id==='qa-back'){ qaOpen=false; render(); return; }
  const t=e.target.closest('[data-nav],[data-action]');
  if(!t) return;
  if(t.dataset.nav && !t.dataset.action){ setView(t.dataset.nav); return; }
  if(t.dataset.action==='menu'){ const sb=document.getElementById('sidebar'); sb.classList.toggle('open'); document.getElementById('scrim').classList.toggle('show'); return; }
  if(t.dataset.action==='add'){ qaOpen=!qaOpen; render(); return; }
  route(t);
}
function route(t){
  const a=t.dataset.action;
  if(a==='qa'){ const ty=t.dataset.type; qaOpen=false; quickAdd(ty); return; }
  if(a==='search'){ openSearch(); return; }
  if(a==='theme-toggle'){ const nv=(document.documentElement.dataset.theme==='dark')?'light':'dark'; applyTheme(nv); return; }
  if(a==='theme-set'){ applyTheme(t.dataset.v); return; }
  if(a==='palette-set'){ applyPalette(t.dataset.v); return; }
  if(a==='storage-retry'){initRemoteSync();return;}
  if(a==='ai-save'){saveAiSettings();return;}
  if(a==='ai-test'){testAiSettings();return;}
  if(a==='ai-clear'){clearAiSettings();return;}
  if(a==='ai-preview'){openAiPreview();return;}
  if(a==='ai-generate-confirm'){generateAiReading();return;}
  if(a==='modal-cancel'){return;}
  if(a==='digest-shuffle'){digestShuffle++;render();return;}
  if(a==='review-expand'){const card=t.closest('.review-focus');const text=card&&card.querySelector('.review-text');if(!text)return;const expanded=text.classList.toggle('expanded');t.textContent=expanded?'收起全文':'展开全文';t.setAttribute('aria-expanded',expanded?'true':'false');return;}
  if(a==='ai-remove'){if(S.aiReadings)delete S.aiReadings[todayISO()];save();render();return;}
  if(a==='ai-reflect'){const k=S.knowledge.find(z=>z.id===t.dataset.id);if(k){kbSelTags=new Set(k.tags||[]);setView('knowledge');setTimeout(()=>{const el=document.getElementById('kb-in');if(el)el.focus();},60);}return;}
  if(a==='sync-login'||a==='sync-register'){ submitSyncAuth(a==='sync-login'?'login':'register'); return; }
  if(a==='sync-use-cloud'||a==='sync-use-local'){ resolveSyncConflict(a==='sync-use-local'); return; }
  if(a==='sync-logout'){ logoutSyncAccount(); return; }
  if(a==='complete'){ const x=S.tasks.find(z=>z.id===t.dataset.id);
    if(x){ x.completed=!x.completed; x.status = x.completed ? 'done' : (x.status==='done' ? 'backlog' : x.status); save(); render(); } return; }
  if(a==='task-tomorrow'){ const x=S.tasks.find(z=>z.id===t.dataset.id); if(x){ x.due=addDaysISO(todayISO(),1); save(); render(); toast('已移到明天'); } return; }
  if(a==='edit' && t.dataset.kind==='task'){ openTaskForm(S.tasks.find(z=>z.id===t.dataset.id)); return; }
  if(a==='proj-open'){ projFilter=t.dataset.proj; render(); return; }
  if(a==='task-add'){ openTaskForm(null); return; }
  if(a==='project-add'){ openProjectForm(null); return; }
  if(a==='project-edit'){ openProjectForm(t.dataset.key); return; }
  if(a==='project-delete'){ deleteProject(t.dataset.key); return; }
  if(a==='habit-add'){ openHabitForm(null); return; }
  if(a==='habit-edit'){ openHabitForm(t.dataset.key); return; }
  if(a==='habit-delete'){ deleteHabit(t.dataset.key); return; }
  if(a==='home-task-add'){
    const ti=document.getElementById('home-task-title'); const pr=document.getElementById('home-task-proj');
    const title=(ti?ti.value:'').trim();
    if(!title){ toast('先写点任务内容吧'); return; }
    const proj=pr?pr.value:PROJ_ORDER[0];
    S.tasks.push({id:uid('t'),title:title,project:proj,priority:'medium',status:'backlog',due:todayISO(),time:'',completed:false,notes:''});
    save(); render(); toast('已添加：'+title);
    return;
  }
  if(a==='task-add-status'){ const proj=t.dataset.proj||(projFilter==='all'?PROJ_ORDER[0]:projFilter); openTaskForm({project:proj,priority:'medium',status:t.dataset.status,due:'',time:'',notes:''}); return; }
  if(a==='task-del'){ const x=S.tasks.find(z=>z.id===t.dataset.id); if(!x) return; if(!confirm('删除任务「'+x.title+'」？')) return; S.tasks=S.tasks.filter(z=>z.id!==t.dataset.id); save(); render(); toast('已删除'); return; }
  if(a==='proj-open'){ projFilter=t.dataset.proj; render(); return; }
  if(a==='proj-filter'){ projFilter=t.dataset.v; render(); return; }
  /* 打卡 / 心情 / 随笔 */
  if(a==='ci'){ const d=todayISO(); if(!S.checkins[d]) S.checkins[d]={}; S.checkins[d][t.dataset.k]=!S.checkins[d][t.dataset.k]; save(); render(); return; }
  if(a==='mood'){ S.moods[todayISO()]=t.dataset.v; save(); render(); toast('心情已记录 '+t.dataset.v); return; }
  if(a==='notes-save'){ const v=((document.getElementById('notes-in')||{}).value||'').trim(); if(!v){ toast('写点什么再保存吧'); return; } S.knowledge.unshift({id:uid('k'),text:v,tags:['随笔'],created:todayISO()}); const inp=document.getElementById('notes-in'); if(inp) inp.value=''; save(); render(); toast('随笔已保存到知识库'); return; }
  /* 知识库 */
  if(a==='kb-add'){ const v=((document.getElementById('kb-in')||{}).value||'').trim(); if(!v){ toast('写点什么再保存吧'); return; } const raw=((document.getElementById('kb-tag-input')||{}).value||''); const manual=raw.split(/[\s,，]+/).map(kbNormTag).filter(Boolean); const tags=[...new Set([...kbSelTags,...manual,...kbInlineTags(v)])]; S.knowledge.unshift({id:uid('k'),text:v,tags,created:new Date().toISOString(),favorite:false,reviewCount:0}); kbRegisterTags(tags); kbSelTags.clear(); save(); render(); toast('已记录到本地知识库'); return; }
  if(a==='kb-tag-toggle'){ const tg=t.dataset.tag; if(kbSelTags.has(tg)) kbSelTags.delete(tg); else kbSelTags.add(tg); const c=t.closest('.kb-chip'); if(c){ c.classList.toggle('on', kbSelTags.has(tg)); c.setAttribute('data-on', kbSelTags.has(tg)?'1':'0'); } return; }
  if(a==='kb-edit'){ const k=S.knowledge.find(z=>z.id===t.dataset.id); if(!k) return; kbEditingId=k.id; kbEditTags=new Set((k.tags||[]).map(kbNormTag).filter(Boolean)); render(); return; }
  if(a==='kb-edit-cancel'){ kbEditingId=null; kbEditTags.clear(); render(); return; }
  if(a==='kb-edit-save'){ const k=S.knowledge.find(z=>z.id===t.dataset.id); const card=t.closest('[data-kb-editor]'); if(!k||!card) return; const text=((card.querySelector('.kb-inline-text')||{}).value||'').trim(); if(!text){ toast('卡片内容不能为空'); return; } const pending=kbNormTag(((card.querySelector('.kb-inline-tag-input')||{}).value||'')); if(pending) kbEditTags.add(pending); const tags=[...new Set([...kbEditTags,...kbInlineTags(text)].map(kbNormTag).filter(Boolean))]; k.text=text; k.tags=tags; kbRegisterTags(tags); kbEditingId=null; kbEditTags.clear(); save(); render(); toast('知识卡片已更新'); return; }
  if(a==='kb-edit-tag-remove'){ kbEditTags.delete(kbNormTag(t.dataset.tag)); kbRefreshEditChips(); return; }
  if(a==='kb-compose-tag-remove'){ kbSelTags.delete(kbNormTag(t.dataset.tag)); kbRefreshComposeChips(); return; }
  if(a==='kb-filter'){ kbFocusId=null; kbFilter=t.dataset.v; kbLimit=30; render(); return; }
  if(a==='kb-focus-clear'){ kbFocusId=null; kbQuery=''; kbFilter='all'; kbLimit=30; render(); return; }
  if(a==='kb-more'){ kbLimit+=30; render(); return; }
  if(a==='kb-favorite'){ const k=S.knowledge.find(z=>z.id===t.dataset.id); if(k){ k.favorite=!k.favorite; save(); render(); toast(k.favorite?'已收藏':'已取消收藏'); } return; }
  if(a==='kb-open'){ const k=S.knowledge.find(z=>z.id===t.dataset.id); if(k){ k.lastReviewed=todayISO(); k.reviewCount=(k.reviewCount||0)+1; save(); kbFocusId=k.id; kbQuery=''; kbFilter='all'; kbSort='newest'; setView('knowledge'); } return; }
  if(a==='kb-del'){ S.knowledge=S.knowledge.filter(z=>z.id!==t.dataset.id); if(kbEditingId===t.dataset.id){ kbEditingId=null; kbEditTags.clear(); } save(); render(); toast('已删除'); return; }
  if(a==='kb-tag-add'){ const name=kbNormTag(prompt('新标签（支持 #标签/子标签/子标签）')||''); if(!name) return; if(!(S.knowledgeTags||[]).includes(name)){ S.knowledgeTags=[...(S.knowledgeTags||[]),name]; save(); } kbOpenTags.add(name.split('/').slice(0,-1).join('/')); render(); toast('已添加分级标签'); return; }
  if(a==='kb-tree-toggle'){ const tag=t.dataset.tag; if(kbOpenTags.has(tag)) kbOpenTags.delete(tag); else kbOpenTags.add(tag); render(); return; }
  if(a==='kb-tag-edit'){ const old=t.dataset.tag; const nn=kbNormTag(prompt('重命名标签「#'+old+'」\n父标签重命名会同步更新全部子标签。',old)||''); if(!nn||nn===old) return; const rename=x=>x===old?nn:(x.startsWith(old+'/')?nn+x.slice(old.length):x); S.knowledge.forEach(k=>{ k.tags=[...new Set((k.tags||[]).map(rename))]; }); if(S.knowledgeTags) S.knowledgeTags=[...new Set(S.knowledgeTags.map(rename))]; if(kbFilter===old||kbFilter.startsWith(old+'/')) kbFilter=rename(kbFilter); save(); render(); toast('已重命名标签树'); return; }
  if(a==='kb-tag-del'){ const tg=t.dataset.tag; if(!confirm('删除「#'+tg+'」及其全部子标签，并从相关笔记移除？')) return; const within=x=>x===tg||x.startsWith(tg+'/'); S.knowledge.forEach(k=>{ k.tags=(k.tags||[]).filter(x=>!within(x)); }); if(S.knowledgeTags) S.knowledgeTags=S.knowledgeTags.filter(x=>!within(x)); if(kbFilter===tg||kbFilter.startsWith(tg+'/')) kbFilter='all'; save(); render(); toast('已删除标签树'); return; }
  /* 日历 */
  if(a==='cal-mode'){ calMode=t.dataset.mode; render(); return; }
  if(a==='cal-prev'){ if(calMode==='month'){calCursor.setDate(1);calCursor.setMonth(calCursor.getMonth()-1);} else calCursor.setDate(calCursor.getDate()-7); render(); return; }
  if(a==='cal-next'){ if(calMode==='month'){calCursor.setDate(1);calCursor.setMonth(calCursor.getMonth()+1);} else calCursor.setDate(calCursor.getDate()+7); render(); return; }
  if(a==='checkin-month-prev'){checkinMonthCursor.setDate(1);checkinMonthCursor.setMonth(checkinMonthCursor.getMonth()-1);render();return;}
  if(a==='checkin-month-next'){checkinMonthCursor.setDate(1);checkinMonthCursor.setMonth(checkinMonthCursor.getMonth()+1);render();return;}
  if(a==='add-on-date'){ openTaskForm({project:projFilter==='all'?PROJ_ORDER[0]:projFilter,priority:'medium',status:'backlog',due:t.dataset.date,time:'',notes:''}); return; }
  if(a==='export'){ exportJSON(); return; }
  if(a==='import'){ importJSON(); return; }
  if(a==='reset-demo'){ if(confirm('确定清空全部内容吗？'+(remoteSync.enabled?'这也会清空当前连接的数据库内容。':'')+'请先导出 JSON 备份。此操作不可撤销。')){ S=seed(); hydrateDefinitions();save(); render(); toast('已清空'); } return; }
}

function applyTheme(nv){ if(nv==='dark') document.documentElement.dataset.theme='dark'; else delete document.documentElement.dataset.theme; S.settings.theme=nv; save(); render(); toast(nv==='dark'?'已切换为暗色':'已切换为亮色'); }
function applyPalette(nv){
  if(!PALETTE_OPTIONS.some(option=>option.key===nv)) nv='calm';
  S.settings.palette=nv;
  document.documentElement.dataset.palette=nv;
  save(); render();
  const current=PALETTE_OPTIONS.find(option=>option.key===nv);
  toast('已切换为'+current.label);
}

function bindModalClicks(){
  modalRoot.addEventListener('click',e=>{
    if(e.target.dataset.overlayClose!=null || e.target.classList.contains('overlay')){ closeModal(); return; }
    const t=e.target.closest('[data-nav],[data-action]');
    if(!t) return;
    if(modalRoot.contains(t)) closeModal();
    if(t.dataset.nav && !t.dataset.action){ setView(t.dataset.nav); return; }
    route(t);
  });
}

function quickAdd(ty){
  if(ty==='task') openTaskForm(null);
  else if(ty==='knowledge'){ setView('knowledge'); }
  else if(ty==='review'){ setView('today'); setTimeout(()=>{ const el=document.querySelector('.knowledge-digest'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); },80); }
}

/* drag & drop */
function bindDnD(){
  const app=document.getElementById('app');
  app.addEventListener('dragstart',e=>{ const el=e.target.closest('[data-drag]'); if(el){ el.classList.add('dragging'); e.dataTransfer.setData('text/plain', el.dataset.drag+'|'+el.dataset.id); e.dataTransfer.effectAllowed='move'; } });
  app.addEventListener('dragend',e=>{ const el=e.target.closest('[data-drag]'); if(el) el.classList.remove('dragging'); });
  app.addEventListener('dragover',e=>{ const t=e.target.closest('[data-drop]'); if(t){ e.preventDefault(); t.classList.add('drop'); } });
  app.addEventListener('dragleave',e=>{ const t=e.target.closest('[data-drop]'); if(t) t.classList.remove('drop'); });
  app.addEventListener('drop',e=>{ const t=e.target.closest('[data-drop]'); if(t){ e.preventDefault(); t.classList.remove('drop'); const data=e.dataTransfer.getData('text/plain').split('|'); handleDrop(data[0],data[1],t.dataset); } });
}
function handleDrop(kind,id,drop){
  if(kind==='ub'){ const tk=S.tasks.find(z=>z.id===id); if(!tk) return;
    if(drop.drop==='ub-col' && drop.status){ tk.status=drop.status; tk.completed = drop.status==='done'; save(); render(); toast('→ '+BOARD_COLS.find(c=>c.key===drop.status).label); }
  }
  else if(kind==='cal'){ const tk=S.tasks.find(z=>z.id===id); if(tk&&drop.date){ tk.due=drop.date; save(); render(); toast('改期到 '+drop.date); } }
}

function exportJSON(){ const data=JSON.stringify(S,null,2); const blob=new Blob([data],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='worktable-backup.json'; a.click(); URL.revokeObjectURL(url); toast('已导出'); }
function importJSON(){ const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json'; inp.onchange=()=>{ const f=inp.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ try{ const d=JSON.parse(r.result); if(d.version!==4||d.productId!=='everyday-worktable'){ alert('只能导入 Dayloom 的备份文件'); return; } S=d; hydrateDefinitions();save(); render(); toast('已导入'); }catch(e){ alert('文件无效'); } }; r.readAsText(f); }; inp.click(); }

/* ---------------- INIT ---------------- */
function init(){
  if(!S || S.version!==4 || !Array.isArray(S.tasks)){ S=seed(); }
  /* 一次性清空历史任务（用户要求从零开始） */
  if(!S.settings) S.settings={name:'Steve',theme:'light'};
  if(S.settings.name==='你') S.settings.name='Steve';
  hydrateDefinitions();
  if(S.settings.theme==='dark') document.documentElement.dataset.theme='dark';
  if(!PALETTE_OPTIONS.some(option=>option.key===S.settings.palette)) S.settings.palette='calm';
  document.documentElement.dataset.palette=S.settings.palette;
  if(!S.checkins||typeof S.checkins!=='object'||Array.isArray(S.checkins)) S.checkins={};
  if(!S.moods) S.moods={};
  if(!S.notes) S.notes={};
  if(!S.aiReadings||typeof S.aiReadings!=='object'||Array.isArray(S.aiReadings)) S.aiReadings={};
  if(!Array.isArray(S.knowledge)) S.knowledge=[];
  /* 知识库：迁移 tag→tags 数组，并确保 tags 数组存在 */
  S.knowledge.forEach(k=>{ if(!Array.isArray(k.tags)) k.tags=k.tag?[k.tag]:[]; k.tags=k.tags.map(kbNormTag).filter(Boolean); if(k.favorite==null) k.favorite=false; if(k.reviewCount==null) k.reviewCount=0; delete k.project; });
  if(!Array.isArray(S.knowledgeTags)) S.knowledgeTags=[];
  S.knowledgeTags = [...new Set(S.knowledgeTags.concat(S.knowledge.flatMap(k=>k.tags||[])))];
  if(!S.knowledgeReviewLog) S.knowledgeReviewLog={};
  save();
  bindDnD();
  bindModalClicks();
  const app=document.getElementById('app');
  app.addEventListener('click',onClick);
  app.addEventListener('change',e=>{if(e.target&&e.target.id==='set-name'){S.settings.name=e.target.value.trim();save();render();toast(S.settings.name?'称呼已更新':'已隐藏称呼');}});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape') closeModal();
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){ e.preventDefault(); openSearch(); }
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='a'){ e.preventDefault(); openTaskForm(null); }
  });
  render();
  document.getElementById('app').inert=true;
  initKnowledgeStore();
}
window.addEventListener('beforeunload',event=>{
  if(remoteSync.dirty||remoteSync.pushing){event.preventDefault();event.returnValue='';}
});
init();
