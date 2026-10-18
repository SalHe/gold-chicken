/* 对局 Demo 的本地存储（localStorage）。每条 demo = 起始快照 + 走子序列。 */
const KEY = "gold-chicken.demos.v1";
const LIMIT = 30;

function store(){
  try{
    if (typeof localStorage === "undefined" || !localStorage) return null;
    return localStorage;
  }catch(e){ return null; }
}

export function listDemos(){
  const s = store();
  if (!s) return [];
  try{
    const raw = s.getItem(KEY);
    if (!raw) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  }catch(e){ return []; }
}

function write(list){
  const s = store();
  if (!s) return false;
  try{ s.setItem(KEY, JSON.stringify(list)); return true; }
  catch(e){ return false; }               /* 配额满 / 隐私模式 */
}

export function saveDemo(demo){
  if (!demo || !demo.id || !demo.start || !Array.isArray(demo.actions)) return false;
  const list = listDemos();
  list.unshift(demo);
  if (list.length > LIMIT) list.length = LIMIT;
  return write(list);
}

export function getDemo(id){
  const list = listDemos();
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

export function removeDemo(id){
  return write(listDemos().filter(function(d){ return d.id !== id; }));
}

export function newDemoId(){
  return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* 把剪贴板文本解析成 Demo：接受单个 Demo、Demo 数组，
   也接受整份 localStorage 列表。形状不对的条目直接跳过。 */
export function parseDemos(text){
  let data;
  try{ data = JSON.parse(text); }catch(e){ return []; }
  const arr = Array.isArray(data) ? data : [data];
  const out = [];
  for (let i = 0; i < arr.length; i++){
    const d = arr[i];
    if (!d || typeof d.start !== "string" || !Array.isArray(d.actions) || !d.actions.length) continue;
    try{
      const o = JSON.parse(d.start);
      if (!o || !o.g || !Array.isArray(o.g.board)) continue;
    }catch(e){ continue; }
    out.push(d);
  }
  return out;
}

function sameDemo(a, b){
  return a.start === b.start && JSON.stringify(a.actions) === JSON.stringify(b.actions);
}
/* 导入 Demo：与现有记录完全相同的跳过，其余分配 id 后保存。
   返回成功导入的局数。 */
export function importDemos(text){
  const incoming = parseDemos(text);
  if (!incoming.length) return 0;
  let added = 0;
  for (let i = 0; i < incoming.length; i++){
    const d = incoming[i];
    const list = listDemos();
    let dup = false, j;
    for (j = 0; j < list.length; j++) if (sameDemo(list[j], d)){ dup = true; break; }
    if (dup) continue;
    let id = (typeof d.id === "string" && d.id) ? d.id : "";
    for (j = 0; id && j < list.length; j++) if (list[j].id === id){ id = ""; break; }
    if (!id) id = newDemoId();
    const at = (typeof d.at === "number" && isFinite(d.at)) ? d.at : Date.now();
    if (saveDemo({ id: id, at: at, result: d.result || null, start: d.start, actions: d.actions })) added++;
  }
  return added;
}
