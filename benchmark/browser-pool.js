// Browser-worker transport for the same diagnostic pool. The library is pure
// JS, so workers need neither Node integration nor changes to Electron policy.
const fs = require("node:fs"),
  path = require("node:path");
const { EventEmitter } = require("node:events");
const { Pool } = require("./worker-pool");
class BrowserPool extends Pool {
  constructor(implementation, values, count) {
    const definitions = fs
      .readdirSync(path.join(implementation, "lib"))
      .filter((file) => file.endsWith(".js") || file.endsWith(".json"))
      .map((file) => {
        const source = fs.readFileSync(path.join(implementation, "lib", file), "utf8");
        return file.endsWith(".json")
          ? `${JSON.stringify("./" + file)}:${source}`
          : `${JSON.stringify("./" + file.slice(0, -3))}:function(require,module,exports){\n${source}\n}`;
      });
    const script = `
      const definitions={${definitions.join(",")}},cache={};
      function load(name){if(cache[name])return cache[name].exports;const value=definitions[name];
        if(typeof value!=="function")return value;
        const module=cache[name]={exports:{}};value(load,module,module.exports);return module.exports;}
      let matcher;
      self.onmessage=({data})=>{
        if(data.init){const {offset,values}=data.init;matcher=new(load("./main").Matcher)(values.map((_,i)=>offset+i),values);self.postMessage({ready:true});}
        else{const {job,order}=matcher.rank(data.query,{algorithm:"fuzzaldrin"});
          const raw=job.raw.slice(),sorted=order.slice();self.postMessage({id:data.id,raw,order:sorted},[raw.buffer,sorted.buffer]);}
      };
    `;
    const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
    super(implementation, values, count, (data) => {
      const adapter = new EventEmitter();
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- Chromium Web Worker, not Node's experimental global.
      const worker = new globalThis.Worker(url);
      worker.onmessage = (event) => adapter.emit("message", event.data);
      worker.onerror = (event) => adapter.emit("error", new Error(event.message));
      adapter.postMessage = (message) => worker.postMessage(message);
      adapter.terminate = () => worker.terminate();
      worker.postMessage({ init: data });
      return adapter;
    });
    this.url = url;
  }
  async close() {
    try {
      await super.close();
    } finally {
      URL.revokeObjectURL(this.url);
    }
  }
}
module.exports = { Pool: BrowserPool };
