/* 对局 Demo 的本地存储（localStorage）。每条 demo = 起始快照 + 走子序列。 */
var KEY = "gold-chicken.demos.v1";
var LIMIT = 30;

function store(){
  try{
    if (typeof localStorage === "undefined" || !localStorage) return null;
    return localStorage;
  }catch(e){ return null; }
}

export function listDemos(){
  var s = store();
  if (!s) return [];
  try{
    var raw = s.getItem(KEY);
    if (!raw) return [];
    var a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  }catch(e){ return []; }
}

function write(list){
  var s = store();
  if (!s) return false;
  try{ s.setItem(KEY, JSON.stringify(list)); return true; }
  catch(e){ return false; }               /* 配额满 / 隐私模式 */
}

export function saveDemo(demo){
  if (!demo || !demo.id || !demo.start || !Array.isArray(demo.actions)) return false;
  var list = listDemos();
  list.unshift(demo);
  if (list.length > LIMIT) list.length = LIMIT;
  return write(list);
}

export function getDemo(id){
  var list = listDemos();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

export function removeDemo(id){
  return write(listDemos().filter(function(d){ return d.id !== id; }));
}

export function newDemoId(){
  return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
