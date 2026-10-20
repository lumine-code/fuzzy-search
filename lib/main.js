const { prepare, indexes, slash, upper } = require("./text");
const commandT = require("./command-t");
const fuzzaldrin = require("./fuzzaldrin");

// setTimeout is clamped after nested browser tasks. Node's immediate queue
// yields without adding that delay to each small batch in an Electron renderer.
let taskChannel;
const pendingTasks = [];
const yieldTask = () =>
  new Promise((resolve) => {
    if (typeof setImmediate === "function") return setImmediate(resolve);
    if (typeof MessageChannel === "undefined") return setTimeout(resolve, 0);
    if (!taskChannel) {
      taskChannel = new MessageChannel();
      taskChannel.port1.onmessage = () => pendingTasks.shift()();
    }
    pendingTasks.push(resolve);
    taskChannel.port2.postMessage(0);
  });

function validate(ids, values) {
  if (!Array.isArray(ids))
    throw new Error("Expected an array of unsigned 32-bit integer ids as the first argument");
  if (!Array.isArray(values))
    throw new Error("Expected an array of strings as the second argument");
  if (ids.length !== values.length)
    throw new Error("Expected ids array and values array to have the same length");
  for (let i = 0; i < ids.length; i++) {
    if (!Number.isInteger(ids[i]) || ids[i] < 0 || ids[i] > 0xffffffff)
      throw new Error("Expected first array to only contain unsigned 32-bit integer ids");
    if (typeof values[i] !== "string")
      throw new Error("Expected second array to only contain strings");
  }
}
function rootScore(text, root) {
  if (!root) return 0;
  let i = 0,
    common = 0;
  for (; i < root.length && i < text.value.length; i++) {
    if (root[i] !== text.value[i]) break;
    if (slash(root.charCodeAt(i))) common++;
  }
  if (i === root.length && slash(text.value.charCodeAt(i))) common++;
  return 1000 * common - text.dirs;
}
class Matcher {
  constructor(ids, values, options = {}) {
    this.ignoreDiacritics = !!options.ignoreDiacritics;
    this.candidates = [];
    this.byId = new Map();
    this.job = null;
    this.jobs = new Map();
    this.cacheBytes = 0;
    this.singleTexts = new Map();
    this.singleUnits = 0;
    if (ids !== undefined) this.addCandidates(ids, values);
  }
  addCandidates(ids, values) {
    validate(ids, values);
    this.clearCache();
    for (let i = 0; i < ids.length; i++) {
      if (this.byId.has(ids[i])) continue;
      const candidate = {
        id: ids[i],
        index: this.candidates.length,
        text: prepare(values[i], this.ignoreDiacritics),
      };
      this.byId.set(ids[i], candidate);
      this.candidates.push(candidate);
    }
  }
  removeCandidates(ids) {
    if (!Array.isArray(ids)) throw new Error("Expected an array of unsigned 32-bit integer ids");
    for (const id of ids) {
      if (!Number.isInteger(id) || id < 0 || id > 0xffffffff)
        throw new Error("Expected array to only contain unsigned 32-bit integer ids");
    }
    for (const id of ids) this.byId.delete(id);
    this.candidates = this.candidates.filter((c) => this.byId.has(c.id));
    this.candidates.forEach((c, i) => {
      c.index = i;
    });
    this.clearCache();
  }
  setCandidates(ids, values) {
    validate(ids, values);
    if (
      ids.length === this.candidates.length &&
      this.candidates.every(
        (candidate, i) => candidate.id === ids[i] && candidate.text.value === values[i],
      )
    )
      return;
    const candidates = [],
      byId = new Map();
    let previousTexts;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i],
        value = values[i];
      if (byId.has(id)) continue;
      const previous = this.byId.get(id);
      let text = previous?.text.value === value ? previous.text : undefined;
      if (!text && this.candidates.length) {
        previousTexts ??= new Map(
          this.candidates.map((candidate) => [candidate.text.value, candidate.text]),
        );
        text = previousTexts.get(value);
      }
      const candidate = {
        id,
        index: candidates.length,
        text: text || prepare(value, this.ignoreDiacritics),
      };
      candidates.push(candidate);
      byId.set(id, candidate);
    }
    this.candidates = candidates;
    this.byId = byId;
    this.clearCache();
  }
  clearCache() {
    this.revision = (this.revision || 0) + 1;
    this.job = null;
    this.lastScan = null;
    this.jobs.clear();
    this.cacheBytes = 0;
  }
  trimCache() {
    this.cacheBytes = 0;
    for (const retained of this.jobs.values()) this.cacheBytes += retained.bytes;
    while (this.cacheBytes > 8 * 1024 * 1024 && this.jobs.size) {
      const key = this.jobs.keys().next().value;
      this.cacheBytes -= this.jobs.get(key).bytes;
      this.jobs.delete(key);
    }
  }
  prepareQuery(query, options) {
    if (typeof query !== "string") throw new Error("First argument should be a query string");
    if (!options || typeof options !== "object")
      throw new Error("Second argument should be an options object");
    const normalized = query.replace(/[ \t\n\r\f\v]/g, "");
    const signature = JSON.stringify([
      options.algorithm,
      !!options.caseSensitive,
      !!options.smartCase,
      options.maxGap >>> 0,
      options.usePathScoring !== false,
      !!options.useExtensionBonus,
    ]);
    if (this.job?.query === normalized && this.job.signature === signature) return this.job;
    const key = signature + normalized;
    if (this.jobs.has(key)) {
      const job = this.jobs.get(key);
      this.jobs.delete(key);
      this.jobs.set(key, job);
      return (this.job = job);
    }
    const text = prepare(normalized, this.ignoreDiacritics);
    // Candidate strings stay compact; only the short query needs numeric arrays.
    if (typeof text.codes === "string") {
      text.codes = Uint32Array.from(text.codes, (c) => c.charCodeAt(0));
      text.folded = Uint32Array.from(text.folded, (c) => c.charCodeAt(0));
    }
    const isFuzzaldrin = options.algorithm === "fuzzaldrin" && text.codes.length > 0;
    const fz = isFuzzaldrin ? fuzzaldrin(text, options) : null;
    const score = fz
      ? fz.score
      : commandT(text, {
          ...options,
          queryHasUpper:
            !!options.smartCase && Array.from(normalized).some((c) => upper(c.codePointAt(0))),
        });
    // Only the last fully scanned query may license rejection reuse. A
    // highlight request prepares a query but does not scan the candidate set.
    const required = fz ? fz.core : options.caseSensitive ? text.codes : text.folded;
    let mask = 0;
    for (const c of required) if (c >= 97 && c <= 122) mask |= 1 << (c - 97);
    const job = {
      query: normalized,
      signature,
      text,
      fz,
      score,
      mask,
      required,
      raw: null,
      eligible: null,
      endpoints: null,
      order: null,
      bytes: 0,
    };
    this.job = job;
    if (normalized.length <= 256) {
      this.jobs.set(key, job);
      while (this.jobs.size > 8) {
        const oldest = this.jobs.keys().next().value;
        this.cacheBytes -= this.jobs.get(oldest).bytes;
        this.jobs.delete(oldest);
      }
    }
    return job;
  }
  rank(query, options) {
    const steps = this.rankSteps(query, options);
    let step;
    do step = steps.next();
    while (!step.done);
    return step.value;
  }
  *rankSteps(query, options, cooperative = false, scanOnly = false) {
    const job = this.prepareQuery(query, options);
    const previous = this.lastScan;
    const reuse =
      previous?.raw &&
      previous.signature === job.signature &&
      job.required.length >= previous.required.length &&
      previous.required.every((c, i) => c === job.required[i]) &&
      // Command-T reuses zero scores, not a separate eligibility set. A
      // smart-case penalty can underflow to zero; changing existing letters'
      // case may remove that penalty even when the prepared prefix is unchanged.
      // Use the original normalized query: diacritic preparation can itself
      // erase case, whereas smart-case activation inspects the original query.
      (job.fz || job.query.startsWith(previous.query));
    const candidates = this.candidates;
    const limit = options.maxResults >>> 0;
    const modify = options.scoreModifier;
    if (!job.raw) {
      const emptyRefinement = reuse && job.fz && previous.fz && previous.eligible?.length === 0;
      job.raw = new Float32Array(emptyRefinement ? 0 : candidates.length);
      job.bytes += job.raw.byteLength;
      this.cacheBytes += job.raw.byteLength;
      if (job.fz) {
        const incremental = reuse && previous.fz && previous.endpoints;
        const source = incremental ? previous.eligible : null;
        const eligible = [];
        const endpoints = new Int32Array(emptyRefinement ? 0 : candidates.length);
        endpoints.fill(-1);
        const length = source ? source.length : candidates.length;
        for (let index = 0; index < length; index++) {
          if (cooperative && (index & 255) === 0) yield;
          const i = source ? source[index] : index;
          const text = candidates[i].text;
          if ((text.mask & job.mask) !== job.mask) continue;
          const end = job.fz.endIndex(
            text,
            incremental ? previous.required.length : 0,
            incremental ? previous.endpoints[i] : 0,
          );
          if (end < 0) continue;
          endpoints[i] = end;
          eligible.push(i);
          // Scoring depends on the complete query, including optional characters.
          job.raw[i] = job.fz.scoreEligible(text);
        }
        job.eligible = Uint32Array.from(eligible);
        job.endpoints = endpoints;
        job.bytes += endpoints.byteLength + job.eligible.byteLength;
      } else {
        for (let i = 0; i < candidates.length; i++) {
          if (cooperative && (i & 255) === 0) yield;
          if (reuse && !previous.raw[i]) continue;
          const text = candidates[i].text;
          if ((text.mask & job.mask) === job.mask) job.raw[i] = job.score(text);
        }
      }
    }
    // Bound retained eligibility state even if a caller's score modifier throws.
    this.trimCache();
    this.lastScan = job;
    if (scanOnly) return { job };
    const root = options.rootPath || "";
    if (
      !modify &&
      job.order &&
      job.root === root &&
      (job.limit === 0 || (limit > 0 && limit <= job.limit))
    )
      return { job, order: limit ? job.order.subarray(0, limit) : job.order, scores: null };
    const scores = modify ? new Float64Array(candidates.length) : null;
    const roots = root ? new Float64Array(candidates.length) : null;
    const raw = job.raw;
    const compare = (a, b) =>
      (scores ? scores[b] - scores[a] : 0) ||
      raw[b] - raw[a] ||
      (roots ? roots[b] - roots[a] : 0) ||
      candidates[a].text.value.length - candidates[b].text.value.length ||
      candidates[a].id - candidates[b].id;
    const selected = [];
    const eligible = job.eligible;
    for (
      let index = 0, count = eligible ? eligible.length : candidates.length;
      index < count;
      index++
    ) {
      if (cooperative && (index & 255) === 0) yield;
      const i = eligible ? eligible[index] : index;
      if (!raw[i]) continue;
      if (modify) {
        scores[i] = modify(
          job.fz ? Math.min(1, raw[i] / job.fz.ceiling) : raw[i],
          candidates[i].id,
        );
        if (!(scores[i] > 0)) continue;
      }
      if (roots) roots[i] = rootScore(candidates[i].text, root);
      if (!limit) {
        selected.push(i);
        continue;
      }
      // A bounded worst-first heap avoids sorting and allocating every hit.
      if (selected.length < limit) {
        let at = selected.length;
        selected.push(i);
        while (at > 0) {
          const parent = (at - 1) >>> 1;
          if (compare(selected[parent], i) >= 0) break;
          selected[at] = selected[parent];
          at = parent;
        }
        selected[at] = i;
      } else if (compare(i, selected[0]) < 0) {
        let at = 0;
        while (at * 2 + 1 < selected.length) {
          let child = at * 2 + 1;
          if (child + 1 < selected.length && compare(selected[child + 1], selected[child]) > 0)
            child++;
          if (compare(i, selected[child]) >= 0) break;
          selected[at] = selected[child];
          at = child;
        }
        selected[at] = i;
      }
    }
    if (cooperative) {
      yield* sortInBatches(selected, compare);
    } else selected.sort(compare);
    const order = Uint32Array.from(selected);
    if (!modify) {
      const delta = order.byteLength - (job.order?.byteLength || 0);
      job.bytes += delta;
      this.cacheBytes += delta;
      job.order = order;
      job.root = root;
      job.limit = limit;
    }
    this.trimCache();
    return { job, order, scores };
  }
  match(query, options = {}) {
    const { job, order, scores } = this.rank(query, options);
    return Array.from(order, (i) => {
      const candidate = this.candidates[i];
      const score = scores
        ? scores[i]
        : job.fz
          ? Math.min(1, job.raw[i] / job.fz.ceiling)
          : job.raw[i];
      const value = { id: candidate.id, value: candidate.text.value, score };
      if (options.recordMatchIndexes) value.matchIndexes = this.indexesFor(candidate, job);
      return value;
    });
  }
  matchIds(query, options = {}) {
    const { order } = this.rank(query, options);
    return Array.from(order, (i) => this.candidates[i].id);
  }
  /**
   * Rank every candidate while yielding to the host between bounded batches.
   * Callbacks execute on the calling thread. Cancellation or source replacement
   * rejects without publishing a partial score cache or a partial result.
   */
  matchIdsAsync(query, options = {}, control = {}) {
    return this.runAsync(query, options, control, false);
  }
  // Worker transports can adjust scores on their owning thread before sorting.
  // This is an internal score snapshot, with the same atomic cache publication.
  scanAsync(query, options = {}, control = {}) {
    return this.runAsync(query, options, control, true);
  }
  async runAsync(query, options, { signal }, scanOnly) {
    const revision = this.revision;
    const fork = new Matcher();
    fork.ignoreDiacritics = this.ignoreDiacritics;
    fork.candidates = this.candidates;
    fork.byId = this.byId;
    fork.jobs = new Map(Array.from(this.jobs, ([key, job]) => [key, { ...job }]));
    fork.lastScan = this.lastScan;
    const check = () => {
      if (signal?.aborted) throw signal.reason;
      if (revision !== this.revision)
        throw new Error("Candidates changed during asynchronous matching");
    };
    await yieldTask();
    const steps = fork.rankSteps(query, options, true, scanOnly);
    let deadline = performance.now() + 6;
    let step;
    do {
      check();
      step = steps.next();
      if (!step.done && performance.now() >= deadline) {
        await yieldTask();
        deadline = performance.now() + 6;
      }
    } while (!step.done);
    const result = scanOnly ? step.value.job : new Array(step.value.order.length);
    for (let i = 0; !scanOnly && i < result.length; i++) {
      result[i] = this.candidates[step.value.order[i]].id;
      if ((i & 1023) === 0 && performance.now() >= deadline) {
        await yieldTask();
        check();
        deadline = performance.now() + 6;
      }
    }
    check();
    this.jobs = fork.jobs;
    this.job = fork.job;
    this.lastScan = fork.lastScan;
    this.cacheBytes = fork.cacheBytes;
    return result;
  }
  matchCandidate(value, query, options = {}) {
    if (typeof value !== "string") throw new TypeError("Candidate must be a string");
    let text = this.singleTexts.get(value);
    if (!text) {
      text = prepare(value, this.ignoreDiacritics);
      if (value.length <= 65536) {
        this.singleTexts.set(value, text);
        this.singleUnits += value.length;
        while (this.singleTexts.size > 128 || this.singleUnits > 65536) {
          const oldest = this.singleTexts.keys().next().value;
          this.singleUnits -= oldest.length;
          this.singleTexts.delete(oldest);
        }
      }
    }
    const job = this.prepareQuery(query, options);
    const raw = job.score(text);
    if (!(raw > 0)) return undefined;
    let score = job.fz ? Math.min(1, raw / job.fz.ceiling) : raw;
    if (options.scoreModifier) score = options.scoreModifier(score, 0);
    if (!(score > 0)) return undefined;
    const result = { id: 0, value, score };
    if (options.recordMatchIndexes) {
      const positions = job.fz ? job.fz.indexes(text) : [];
      if (!job.fz) job.score(text, positions);
      result.matchIndexes = indexes(text, positions);
    }
    return result;
  }
  getMatchIndexes(id, query, options = {}) {
    const candidate = this.byId.get(id);
    if (!candidate) return null;
    const job = this.prepareQuery(query, options);
    return this.indexesFor(candidate, job);
  }
  indexesFor(candidate, job) {
    let positions;
    if (job.fz) {
      if (!(job.raw ? job.raw[candidate.index] : job.score(candidate.text))) return null;
      positions = job.fz.indexes(candidate.text);
    } else {
      positions = [];
      if (!job.score(candidate.text, positions)) return null;
    }
    return indexes(candidate.text, positions);
  }
}
function* sortInBatches(values, compare) {
  const block = 1024;
  for (let start = 0; start < values.length; start += block) {
    const sorted = values.slice(start, start + block).sort(compare);
    for (let i = 0; i < sorted.length; i++) values[start + i] = sorted[i];
    yield;
  }
  let source = values;
  let target = new Array(values.length);
  for (let width = block; width < values.length; width *= 2) {
    for (let start = 0; start < values.length; start += width * 2) {
      let left = start;
      const middle = Math.min(start + width, values.length);
      let right = middle;
      const end = Math.min(start + width * 2, values.length);
      for (let at = start; at < end; at++) {
        target[at] =
          left < middle && (right >= end || compare(source[left], source[right]) <= 0)
            ? source[left++]
            : source[right++];
        if ((at & 1023) === 0) yield;
      }
    }
    [source, target] = [target, source];
  }
  if (source !== values)
    for (let i = 0; i < values.length; i++) {
      values[i] = source[i];
      if ((i & 1023) === 0) yield;
    }
}
module.exports = { Matcher };
