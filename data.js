/* 通用工作台的空白初始数据。不要在此文件放入任何个人笔记或账号信息。 */
function uid(p){ return (p||'id') + Math.random().toString(36).slice(2,9); }
function todayMid(){ const x=new Date(); x.setHours(0,0,0,0); return x; }
function isoLocal(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function dOff(n){ const x=todayMid(); x.setDate(x.getDate()+n); return isoLocal(x); }
function addDaysISO(iso,n){ const x=new Date(iso+'T00:00:00'); x.setDate(x.getDate()+n); return isoLocal(x); }

const PROJECTS={
  work:{key:'work',name:'工作事业',en:'Work',icon:'briefcase',color:'#376b91',short:'工作'},
  learning:{key:'learning',name:'长期学习',en:'Learning',icon:'book',color:'#7960a8',short:'学习'},
  health:{key:'health',name:'运动健康',en:'Health',icon:'activity',color:'#3e806b',short:'健康'},
  hobby:{key:'hobby',name:'兴趣爱好',en:'Hobbies',icon:'star',color:'#bb7a48',short:'兴趣'},
  life:{key:'life',name:'日常生活',en:'Life',icon:'home',color:'#4e8290',short:'生活'},
  plans:{key:'plans',name:'副业探索',en:'Side Projects',icon:'target',color:'#a65e83',short:'副业'}
};
const PROJ_ORDER=['work','learning','health','hobby','life','plans'];
const PRIORITY={high:{label:'高',color:'#ad5558'},medium:{label:'中',color:'#8a704b'},low:{label:'低',color:'#77837f'}};
const TASK_STATUS_LABEL={backlog:'待办',todo:'待办',inprogress:'进行中',review:'待检查',done:'已完成'};
const BOARD_COLS=[{key:'backlog',label:'待办',color:'#75817d'},{key:'inprogress',label:'进行中',color:'#244b5a'},{key:'review',label:'待检查',color:'#52676f'},{key:'done',label:'已完成',color:'#56756b'}];
const CHECKIN_DEFS=[
  {k:'sleep',icon:'moon',l:'早睡',emoji:'🌙'},
  {k:'exercise',icon:'activity',l:'运动',emoji:'🏃'},
  {k:'reading',icon:'book',l:'阅读',emoji:'📖'},
  {k:'study',icon:'brain',l:'学习',emoji:'✍️',color:'#7960a8'}
];
const HABIT_COLORS=['#3e806b','#376b91','#a65e83','#7960a8','#bb7a48','#4e8290'];
CHECKIN_DEFS[0].color='#3e806b'; CHECKIN_DEFS[1].color='#376b91'; CHECKIN_DEFS[2].color='#a65e83';
const PROJECT_DEFAULTS=PROJ_ORDER.map(k=>({...PROJECTS[k]}));
const HABIT_DEFAULTS=CHECKIN_DEFS.map(c=>({...c,createdAt:null,archivedAt:null}));
const MOODS=['😫','😕','😐','🙂','🤩'];
const ICONS={
  home:'<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  fire:'<path d="M12 3s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 9 12 8 12 3z"/>',
  calendar:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',check:'<path d="M20 6L9 17l-5-5"/>',x:'<path d="M18 6L6 18M6 6l12 12"/>',
  edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',flag:'<path d="M4 22V4h13l-2 4 2 4H4"/>',
  chevron:'<path d="M9 6l6 6-6 6"/>',chevL:'<path d="M15 6l-6 6 6 6"/>',chevR:'<path d="M9 6l6 6-6 6"/>',
  dots:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  book:'<path d="M4 4h11a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z"/><path d="M4 4v16"/>',
  briefcase:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5h8v2M3 12h18"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  star:'<path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8L6.6 19.6l1-6L3.3 9.4l6-.9z"/>',
  trend:'<path d="M3 17l6-6 4 4 7-7"/><path d="M21 8v4h-4"/>',
  brain:'<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  calendarD:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  note:'<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/>',
  drag:'<circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
  chevD:'<path d="M6 9l6 6 6-6"/>',up:'<path d="M12 19V5M5 12l7-7 7 7"/>',down:'<path d="M12 5v14M19 12l-7 7-7-7"/>',
  indent:'<path d="M3 6h18M8 12h13M8 18h13M3 12l3 3-3 3"/>',outdent:'<path d="M3 6h18M11 12h10M11 18h10M6 12l-3 3 3 3"/>',
  subplus:'<path d="M5 4v10a3 3 0 0 0 3 3h4"/><path d="M17 14v6M14 17h6"/>',layers:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
  columns:'<rect x="3" y="3" width="7" height="16" rx="1.5"/><rect x="14" y="3" width="7" height="16" rx="1.5"/>',
  link:'<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  external:'<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>',
  download:'<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>',upload:'<path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M4 3h16"/>',
  grid:'<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  bulb:'<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a6 6 0 0 0-3.5 10.9c.3.3.5.7.5 1.1v1h6v-1c0-.4.2-.8.5-1.1A6 6 0 0 0 12 2z"/>',
  spark:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18 16l.9 2.6L21.5 19l-2.6.9L18 22l-.9-2.1L14.5 19l2.6-.4z"/>',
  inbox:'<path d="M4 13h4l2 3h4l2-3h4"/><path d="M4 13l2-8h12l2 8v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  send:'<path d="M21 3L3 10l7 3 3 7z"/><path d="M21 3l-9 11"/>',copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  wand:'<path d="M15 4V2"/><path d="M15 8V6"/><path d="M15 12v-2"/><path d="M13 6h-2"/><path d="M17 6h-2"/><path d="M6 19l9-9"/>',
  feishu:'<path d="M4 6h10a6 6 0 0 1 0 12H4z"/><path d="M4 12h7"/>',
  rss:'<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 5a15 15 0 0 1 15 15"/><circle cx="19" cy="19" r="2.4"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/>',
  heart:'<path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/>',
  smile:'<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  activity:'<path d="M4 13h3l2-6 4 11 2-5h5"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2"/>',
  moon:'<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/>'
};
function ic(name,size,cls){ const s=size||18; return '<svg class="'+(cls||'')+'" width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(ICONS[name]||'')+'</svg>'; }
const NAV=[{type:'item',view:'home',label:'首页',icon:'home'},{type:'item',view:'today',label:'今日',icon:'fire'},{type:'item',view:'calendar',label:'日历',icon:'calendar'},{type:'item',view:'projects',label:'项目',icon:'target'},{type:'item',view:'knowledge',label:'知识库',icon:'bulb'},{type:'item',view:'statistics',label:'数据',icon:'trend'},{type:'item',view:'settings',label:'设置',icon:'settings'}];

function seed(){
  return {version:4,productId:'everyday-worktable',settings:{name:'你',theme:'light',palette:'calm'},tasks:[],knowledge:[],knowledgeTags:[],knowledgeReviewLog:{},checkins:{},moods:{},notes:{},dailyLogs:[],projects:PROJECT_DEFAULTS.map(p=>({...p})),habits:HABIT_DEFAULTS.map(c=>({...c}))};
}
