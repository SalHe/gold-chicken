/* 轻量 DOM 桩：提供渲染所需的 document/window，幂等挂载。 */
function El(tag){
  const el = {
    tagName: tag || "div",
    children: [],
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
    remove(){},
    querySelector(){ return El("span"); },
    querySelectorAll(){ return []; },
    addEventListener(){},
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
  globalThis.window = {};
}
export { El };
