// Diagnostic resident-worker experiment, not a synchronous Matcher replacement.
// Candidates are sent once. Each query returns typed scores and local order;
// the caller merges those orders without cloning candidate strings.
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
if (!isMainThread) {
  const { Matcher } = require(workerData.implementation);
  const m = new Matcher(
    workerData.values.map((_, i) => workerData.offset + i),
    workerData.values,
  );
  parentPort.on("message", ({ id, query }) => {
    const { job, order } = m.rank(query, { algorithm: "fuzzaldrin" });
    const raw = job.raw.slice(),
      sorted = order.slice();
    parentPort.postMessage({ id, raw, order: sorted }, [raw.buffer, sorted.buffer]);
  });
  parentPort.postMessage({ ready: true });
} else {
  class Pool {
    constructor(implementation, values, count, createWorker) {
      this.values = values;
      this.serial = 0;
      this.closed = false;
      this.workers = [];
      this.ready = Promise.all(
        Array.from({ length: count }, (_, i) => {
          const offset = Math.floor((values.length * i) / count);
          const end = Math.floor((values.length * (i + 1)) / count);
          const data = { implementation, offset, values: values.slice(offset, end) };
          const worker = createWorker
            ? createWorker(data)
            : new Worker(__filename, { workerData: data });
          const state = { worker, offset, pending: new Map() };
          this.workers.push(state);
          return new Promise((resolve, reject) => {
            worker.on("message", (message) => {
              if (message.ready) resolve();
              else {
                state.pending.get(message.id)?.resolve(message);
                state.pending.delete(message.id);
              }
            });
            worker.on("error", (error) => {
              reject(error);
              for (const pending of state.pending.values()) pending.reject(error);
              state.pending.clear();
            });
            worker.on("exit", (code) => {
              if (!this.closed) {
                const error = new Error(`Worker exited with ${code}`);
                reject(error);
                for (const pending of state.pending.values()) pending.reject(error);
              }
            });
          });
        }),
      );
    }
    async matchIds(query) {
      await this.ready;
      const id = ++this.serial;
      const parts = await Promise.all(
        this.workers.map(
          (state) =>
            new Promise((resolve, reject) => {
              state.pending.set(id, { resolve, reject });
              state.worker.postMessage({ id, query });
            }),
        ),
      );
      const positions = new Uint32Array(parts.length);
      const result = new Array(parts.reduce((sum, part) => sum + part.order.length, 0));
      for (let i = 0; i < result.length; i++) {
        let winner = -1,
          bestId = 0,
          bestScore = 0;
        for (let p = 0; p < parts.length; p++) {
          const part = parts[p];
          if (positions[p] === part.order.length) continue;
          const index = part.order[positions[p]],
            candidateId = this.workers[p].offset + index;
          const score = part.raw[index];
          if (
            winner === -1 ||
            score > bestScore ||
            (score === bestScore &&
              (this.values[candidateId].length < this.values[bestId].length ||
                (this.values[candidateId].length === this.values[bestId].length &&
                  candidateId < bestId)))
          ) {
            winner = p;
            bestId = candidateId;
            bestScore = score;
          }
        }
        positions[winner]++;
        result[i] = bestId;
      }
      return result;
    }
    async close() {
      this.closed = true;
      for (const state of this.workers) {
        for (const pending of state.pending.values()) pending.reject(new Error("Pool closed"));
        state.pending.clear();
      }
      await Promise.all(this.workers.map((state) => state.worker.terminate()));
    }
  }
  module.exports = { Pool };
}
