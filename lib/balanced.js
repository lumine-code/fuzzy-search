// A bounded-row alignment scorer for interactive lists. Ranking and traceback
// use the same recurrence; basename preference never changes eligibility.
const { at, slash, wordStart } = require("./text");

module.exports = function createScorer(query, options) {
  const positions = [];
  for (let i = 0; i < query.codes.length; i++) {
    const c = query.codes[i];
    if (c !== 32 && c !== 95 && c !== 45 && c !== 58 && !slash(c)) positions.push(i);
  }
  const original = Uint32Array.from(positions, (i) => query.codes[i]);
  const core = Uint32Array.from(positions, (i) => query.folded[i]);
  const n = core.length;
  const best = new Float64Array(n + 1),
    adjacent = new Float64Array(n + 1);
  let trace = new Uint8Array(0);
  const queryChars = Array.from(core, (c) => String.fromCodePoint(c));
  function align(t, from, end, record) {
    if (!n || end - from < n) return null;
    if (n === 1) {
      let quality = -Infinity,
        position = -1;
      for (let i = from; i < end; i++) {
        if (typeof t.folded === "string") {
          i = t.folded.indexOf(queryChars[0], i);
          if (i < 0 || i >= end) break;
        } else if (at(t.folded, i) !== core[0]) continue;
        const value =
          -Math.min(i - from, 20) +
          16 +
          (i === from || wordStart(t, i, true) ? 28 : 0) +
          (at(t.codes, i) === original[0] ? 1 : 0) +
          (i === end - 1 ? 8 : 0);
        if (value > quality) {
          quality = value;
          position = i;
        }
      }
      if (position < 0) return null;
      return record ? { score: quality, matches: [position] } : quality;
    }
    let scan = from;
    for (let j = 0; j < n; j++) {
      if (typeof t.folded === "string") scan = t.folded.indexOf(queryChars[j], scan);
      else {
        while (scan < end && at(t.folded, scan) !== core[j]) scan++;
      }
      if (scan < 0 || scan >= end) return null;
      scan++;
    }
    // Restrict the DP to the final possible occurrence of the last character.
    let last = end - 1;
    while (at(t.folded, last) !== core[n - 1]) last--;
    const size = (last - from + 1) * n;
    const tracing = record && size <= 2 ** 22;
    if (tracing && trace.length < size) trace = new Uint8Array(size);
    best.fill(-Infinity);
    adjacent.fill(-Infinity);
    best[0] = 0;
    for (let i = from; i <= last; i++) {
      const c = at(t.folded, i);
      const boundary = i === from || wordStart(t, i, true);
      for (let j = Math.min(n, i - from + 1); j > 0; j--) {
        const skipped = best[j] - (j === n ? 0 : 1);
        let taken = -Infinity,
          fromAdjacent = false;
        if (c === core[j - 1]) {
          const consecutive = j > 1 ? adjacent[j - 1] + 6 : -Infinity;
          fromAdjacent = consecutive > best[j - 1];
          taken =
            Math.max(best[j - 1], consecutive) +
            16 +
            (boundary ? 16 + (j === 1 ? 12 : 0) : 0) +
            (at(t.codes, i) === original[j - 1] ? 1 : 0) +
            (j === n && i === end - 1 ? 8 : 0);
        }
        adjacent[j] = taken;
        best[j] = Math.max(skipped, taken);
        if (tracing)
          trace[(i - from) * n + j - 1] = (taken > skipped ? 1 : 0) | (fromAdjacent ? 2 : 0);
      }
      best[0] = -Math.min(i - from + 1, 20);
    }
    const score = best[n];
    if (!record) return score;
    const matches = [];
    if (tracing) {
      let i = last,
        j = n,
        inAdjacent = false;
      while (i >= from && j > 0) {
        const flags = trace[(i - from) * n + j - 1];
        if (inAdjacent || flags & 1) {
          matches.push(i);
          j--;
          inAdjacent = !!(flags & 2);
        }
        i--;
      }
      matches.reverse();
      if (trace.length > 65536) trace = new Uint8Array(0);
    } else {
      let i = from;
      for (const c of core) {
        while (at(t.folded, i) !== c) i++;
        matches.push(i++);
      }
    }
    return { score, matches };
  }
  const baseCache = new Map();
  let baseUnits = 0;
  function choose(t, record) {
    const full = align(t, 0, t.codes.length, record);
    if (full === null) return record ? [] : 0;
    let quality = (record ? full.score : full) - 4 * Math.log2(1 + t.codes.length - n);
    if (
      query.folded.length === t.folded.length &&
      query.folded.every((c, i) => c === at(t.folded, i) || (slash(c) && slash(at(t.folded, i))))
    )
      quality += 16;
    let matches = record ? full.matches : null;
    if (options.usePathScoring !== false) {
      let end = t.codes.length;
      while (end && slash(at(t.codes, end - 1))) end--;
      let base = end - 1;
      while (base >= 0 && !slash(at(t.codes, base))) base--;
      if (base >= 0 && base + 1 < end) {
        const key = !record && typeof t.codes === "string" ? t.codes.slice(base + 1, end) : null;
        let result = key === null ? undefined : baseCache.get(key);
        if (result === undefined) {
          result = align(t, base + 1, end, record);
          if (key !== null && baseCache.size < 2048 && baseUnits + key.length <= 65536) {
            baseCache.set(key, result);
            baseUnits += key.length;
          }
        }
        if (result !== null) {
          const baseQuality =
            (record ? result.score : result) -
            4 * Math.log2(1 + end - base - 1 - n) +
            6 -
            Math.min(t.dirs, 20) * 2;
          if (baseQuality > quality) {
            quality = baseQuality;
            if (record) matches = result.matches;
          }
        }
      }
    }
    if (record) return matches;
    // Keep every eligible subsequence positive, including long prefix gaps.
    return 0.5 + quality / (2 * (Math.abs(quality) + 32 * n));
  }
  return {
    core,
    ceiling: choose(query, false) || 1,
    score: (t) => choose(t, false),
    indexes: (t) => choose(t, true),
  };
};
