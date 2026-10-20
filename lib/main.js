const { prepare, indexes, slash, upper } = require("./text");
const commandT = require("./command-t");
const fuzzaldrin = require("./fuzzaldrin");

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
    this.candidates = [];
    this.byId.clear();
    this.job = null;
    this.addCandidates(ids, values);
  }
  clearCache() {
    this.job = null;
    this.lastScan = null;
    this.jobs.clear();
    this.cacheBytes = 0;
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
    const job = this.prepareQuery(query, options);
    const previous = this.lastScan;
    const reuse =
      previous?.raw &&
      previous.signature === job.signature &&
      job.required.length >= previous.required.length &&
      previous.required.every((c, i) => c === job.required[i]);
    const candidates = this.candidates;
    const limit = options.maxResults >>> 0;
    const modify = options.scoreModifier;
    if (!job.raw) {
      job.raw = new Float32Array(candidates.length);
      job.bytes += job.raw.byteLength;
      this.cacheBytes += job.raw.byteLength;
      const optionalOnly = previous?.fz && previous.required.length === 0;
      for (let i = 0; i < candidates.length; i++) {
        if (reuse && !optionalOnly && !previous.raw[i]) continue;
        const text = candidates[i].text;
        if ((text.mask & job.mask) === job.mask) job.raw[i] = job.score(text);
      }
    }
    this.lastScan = job;
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
      (scores ? scores[b] - scores[a] : raw[b] - raw[a]) ||
      (roots ? roots[b] - roots[a] : 0) ||
      candidates[a].text.value.length - candidates[b].text.value.length ||
      candidates[a].id - candidates[b].id;
    const selected = [];
    for (let i = 0; i < candidates.length; i++) {
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
    selected.sort(compare);
    const order = Uint32Array.from(selected);
    if (!modify) {
      const delta = order.byteLength - (job.order?.byteLength || 0);
      job.bytes += delta;
      this.cacheBytes += delta;
      job.order = order;
      job.root = root;
      job.limit = limit;
    }
    while (this.cacheBytes > 8 * 1024 * 1024 && this.jobs.size) {
      const key = this.jobs.keys().next().value;
      this.cacheBytes -= this.jobs.get(key).bytes;
      this.jobs.delete(key);
    }
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
      if (options.recordMatchIndexes)
        value.matchIndexes = this.getMatchIndexes(candidate.id, query, options);
      return value;
    });
  }
  matchIds(query, options = {}) {
    const { order } = this.rank(query, options);
    return Array.from(order, (i) => this.candidates[i].id);
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
module.exports = { Matcher };
