// Command-T scoring, ported from this project's native implementation.
// Original algorithm by Greg Hurrell; see THIRD_PARTY_NOTICES.
const { at, slash, upper, lower } = require("./text");
const f = Math.fround;

module.exports = function createScorer(query, options) {
  const needle = query.codes;
  const needleCase = options.caseSensitive ? needle : query.folded;
  const needleCharacters = Array.from(needleCase, (c) => String.fromCodePoint(c));
  const n = needle.length;
  const smart = !options.caseSensitive && options.smartCase && options.queryHasUpper;
  const maxGap = options.maxGap >>> 0;
  const last = new Int32Array(n);
  let memo = new Float32Array(0),
    choices = new Int32Array(0);
  let haystack, folded, length, record;
  function nextIndex(q, from) {
    let found = folded.indexOf(needleCharacters[q], from);
    const c = needleCase[q];
    if (c === 95 || slash(c)) {
      for (const separator of ["/", "\\"]) {
        const alternative = folded.indexOf(separator, from);
        if (alternative >= 0 && (found < 0 || alternative < found)) found = alternative;
      }
    }
    return found;
  }
  function visit(start, q) {
    if (q === n) return 1;
    const offset = q * length + start;
    if (memo[offset] >= 0) return memo[offset];
    let best = 0,
      bestIndex = 0,
      lastSlash = 0;
    let limit = last[q];
    if (q > 0 && maxGap && start + maxGap < limit) limit = start + maxGap;
    const c = needleCase[q];
    const stringInput = n > 1 && typeof folded === "string";
    for (
      let j = stringInput ? nextIndex(q, start) : start;
      j >= 0 && j <= limit;
      j = stringInput ? nextIndex(q, j + 1) : j + 1
    ) {
      const d = at(folded, j),
        isSlash = slash(d);
      if (q === 0) {
        if (stringInput)
          lastSlash = Math.max(0, haystack.lastIndexOf("/", j), haystack.lastIndexOf("\\", j));
        else if (isSlash) lastSlash = j;
      }
      if (c !== d && !(isSlash && (c === 95 || slash(c)))) continue;
      let factor = 1;
      if (j > start) {
        const prev = at(haystack, j - 1);
        if (slash(prev)) factor = f(0.9);
        else if (
          prev === 45 ||
          prev === 95 ||
          prev === 32 ||
          (prev >= 48 && prev <= 57) ||
          (lower(prev) && upper(at(haystack, j)))
        )
          factor = f(0.8);
        else if (prev === 46) factor = f(0.7);
        else factor = q === 0 ? f(0.6) : Math.max(f(0.2), f(f(0.6) - f((j - start - 1) * f(0.05))));
      }
      if ((smart || slash(at(haystack, j))) && needle[q] !== at(haystack, j))
        factor = f(factor * 0.001);
      if (q === 0) factor = f(factor / (length - lastSlash));
      const score = f(factor * visit(j + 1, q + 1));
      if (score > best) {
        best = score;
        bestIndex = j;
        if (best === 1) break;
      }
    }
    if (record) choices[offset] = bestIndex;
    memo[offset] = best;
    return best;
  }
  return (text, positions) => {
    if (!n) return 1;
    haystack = text.codes;
    folded = options.caseSensitive ? haystack : text.folded;
    length = haystack.length;
    if (n > length) return 0;
    let h = length;
    for (let i = n - 1; i >= 0; i--) {
      const c = needleCase[i];
      if (typeof folded === "string") {
        if (h === 0) return 0;
        let found = folded.lastIndexOf(needleCharacters[i], h - 1);
        if (c === 95 || slash(c))
          found = Math.max(found, folded.lastIndexOf("/", h - 1), folded.lastIndexOf("\\", h - 1));
        h = found;
      } else
        do {
          h--;
        } while (
          h >= 0 &&
          at(folded, h) !== c &&
          !((c === 95 || slash(c)) && slash(at(folded, h)))
        );
      if (h < 0) return 0;
      last[i] = h;
    }
    const size = length * n;
    if (size >= 10000) {
      let score = 1;
      for (let i = 1; i < n; i++) {
        const gap = last[i] - last[i - 1];
        if (gap > 1) score = f(score * Math.max(f(0.2), f(f(0.6) - f((gap - 1) * f(0.05)))));
      }
      if (positions) positions.push(...last);
      return f(f(score * n) / length);
    }
    if (memo.length < size) memo = new Float32Array(size);
    memo.fill(-1, 0, size);
    record = !!positions;
    if (record && choices.length < size) choices = new Int32Array(size);
    const score = f(n * visit(0, 0));
    if (record && score > 0) {
      let start = 0;
      for (let q = 0; q < n; q++) {
        const p = choices[q * length + start];
        positions.push(p);
        start = p + 1;
      }
    }
    return score;
  };
};
