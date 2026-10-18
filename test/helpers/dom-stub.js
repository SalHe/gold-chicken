/* 轻量 DOM 桩：提供渲染所需的 document/window，幂等挂载。 */
function El(tag){
  const el = {
    tagName: tag || "div",
    children: [],
    get firstChild(){ return this.children.length ? this.children[0] : null; },
    _cls: "",
    textContent: "",
    innerHTML: "",
    dataset: {},
    style: { setProperty(){}, cssText: "" },
    classList: {
      _s: new Set(),
      add(...c){ c.forEach(x => this._s.add(x)); },
      remove(...c){ c.forEach(x => this._s.delete(x)); },
      toggle(c, f){ if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); return f; },
      contains(c){ return this._s.has(c); }
    },
    appendChild(c){ this.children.push(c); return c; },
    removeChild(c){
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    remove(){},
    querySelector(){ return El("span"); },
    querySelectorAll(){ return []; },
    _ls: {},
    addEventListener(type, fn){ (this._ls[type] || (this._ls[type] = [])).push(fn); },
    /* 供测试模拟点击；事件对象只提供 main.js 按钮处理器用到的字段 */
    click(){
      const ev = { target: this, preventDefault(){}, stopPropagation(){} };
      (this._ls.click || []).slice().forEach(function(fn){ fn(ev); });
    },
    setAttribute(){},
    hasAttribute(){ return false; },
    offsetWidth: 0,
    closest(){ return null; }
  };
  Object.defineProperty(el, "className", {
    get(){ return this._cls; },
    set(v){ this._cls = v; }
  });
  return el;
}

let installed = false;
export function installDomStub(){
  if (installed) return;
  installed = true;
  const byId = {};
  globalThis.document = {
    getElementById(id){ return byId[id] || (byId[id] = El()); },
    createElement(t){ return El(t); },
    addEventListener(){}
  };
  globalThis.window = {
    _ls: {},
    addEventListener(type, fn){ (this._ls[type] || (this._ls[type] = [])).push(fn); },
    removeEventListener(){}
  };
}
export { El };
