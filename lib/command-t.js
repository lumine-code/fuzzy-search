// Command-T scoring, ported from this project's native implementation.
// Original algorithm by Greg Hurrell; see THIRD_PARTY_NOTICES.
const { at, slash, upper, lower } = require("./text");
const f = Math.fround;
const MAX_SCORE_CELLS = 10000;
const gapFactors = Array.from({ length: 10 }, (_, gap) =>
  gap === 0 ? 1 : Math.max(f(0.2), f(f(0.6) - f((gap - 1) * f(0.05)))),
);

module.exports = function createScorer(query, options) {
  const needle = query.codes;
  const needleCase = options.caseSensitive ? needle : query.folded;
  const needleCharacters = Array.from(needleCase, (c) => String.fromCodePoint(c));
  const n = needle.length;
  const smart = !options.caseSensitive && options.smartCase && options.queryHasUpper;
  const maxGap = options.maxGap >>> 0;
  const last = new Int32Array(n);
  let next = new Float32Array(0),
    row = new Float32Array(0),
    boundaries = new Float32Array(0),
    distant = new Float32Array(0),
    queue = new Int32Array(0),
    choices = new Int32Array(0);
  let memo = new Float32Array(0),
    record;
  let haystack, folded, length;
  const characters = new Set(needleCase);
  if (characters.has(95) || characters.has(47) || characters.has(92)) {
    characters.add(47);
    characters.add(92);
  }
  const asciiCharacters = new Uint8Array(128);
  for (const c of characters) if (c < 128) asciiCharacters[c] = 1;
  function dense() {
    if (n < 2 || length < 128) return false;
    let count = 0;
    for (let i = 0; i < length; i++) {
      const c = at(folded, i);
      if ((c < 128 ? asciiCharacters[c] : characters.has(c)) && ++count >= 64) return true;
    }
    return false;
  }
  let queryPositions;
  function boundedAlignment() {
    // The latest unrestricted subsequence can violate maxGap even when an
    // earlier alignment fits. Track the latest reachable end of each prefix;
    // it dominates earlier ends for every future bounded-gap transition.
    if (!queryPositions) {
      queryPositions = new Map();
      for (let q = n - 1; q >= 0; q--) {
        const c = needleCase[q];
        const codes = c === 95 ? [95, 47, 92] : slash(c) ? [47, 92] : [c];
        for (const code of codes) {
          if (!queryPositions.has(code)) queryPositions.set(code, []);
          queryPositions.get(code).push(q);
        }
      }
    }
    const reachable = new Int32Array(n).fill(-1),
      links = new Array(n);
    for (let position = 0; position < length; position++) {
      const matches = queryPositions.get(at(folded, position));
      if (!matches) continue;
      for (const q of matches) {
        if (q && (reachable[q - 1] < 0 || position - reachable[q - 1] > maxGap + 1)) continue;
        reachable[q] = position;
        links[q] = { position, previous: q ? links[q - 1] : null };
        if (q === n - 1) {
          let link = links[q];
          for (let i = n - 1; i >= 0; i--) {
            last[i] = link.position;
            link = link.previous;
          }
          return true;
        }
      }
    }
    return false;
  }
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
  function matches(q, j) {
    const c = needleCase[q],
      d = at(folded, j);
    return c === d || (slash(d) && (c === 95 || slash(c)));
  }
  function boundary(j) {
    if (!j) return 0;
    const prev = at(haystack, j - 1);
    if (slash(prev)) return f(0.9);
    if (
      prev === 45 ||
      prev === 95 ||
      prev === 32 ||
      (prev >= 48 && prev <= 57) ||
      (lower(prev) && upper(at(haystack, j)))
    )
      return f(0.8);
    return prev === 46 ? f(0.7) : 0;
  }
  function penalty(factor, q, j) {
    const c = at(haystack, j);
    return (smart || slash(c)) && needle[q] !== c ? f(factor * 0.001) : factor;
  }
  function exact(positions) {
    if (n > 1) {
      if (next.length < length + 1) {
        next = new Float32Array(length + 1);
        row = new Float32Array(length + 1);
        boundaries = new Float32Array(length);
        distant = new Float32Array(length);
        queue = new Int32Array(length);
      }
      next.fill(1, 0, length + 1);
      for (let j = 0; j < length; j++) boundaries[j] = boundary(j);
      if (positions && choices.length < length * n) choices = new Int32Array(length * n);
      // Work backwards through query suffixes. Only the first nine skipped
      // positions have a varying gap penalty; all farther gaps share 0.2.
      // A sliding maximum covers those farther positions, including maxGap,
      // instead of revisiting the same suffix once for every possible start.
      for (let q = n - 1; q > 0; q--) {
        row.fill(0, 0, length + 1);
        for (let j = 0; j <= last[q]; j++)
          distant[j] = matches(q, j) ? f(penalty(boundaries[j] || f(0.2), q, j) * next[j + 1]) : 0;
        let head = 0,
          tail = 0;
        for (let start = last[q]; start >= q; start--) {
          const limit = maxGap ? Math.min(last[q], start + maxGap) : last[q];
          while (head < tail && queue[head] > limit) head++;
          const far = start + 10;
          if (far <= limit && distant[far] > 0) {
            // A newly added equal score is earlier and therefore wins ties.
            while (tail > head && distant[far] >= distant[queue[tail - 1]]) tail--;
            queue[tail++] = far;
          }
          let best = 0,
            bestIndex = 0;
          for (let j = start, end = Math.min(start + 9, limit); j <= end; j++) {
            if (!matches(q, j)) continue;
            const factor = j === start ? 1 : boundaries[j] || gapFactors[j - start];
            const score = f(penalty(factor, q, j) * next[j + 1]);
            if (score > best) {
              best = score;
              bestIndex = j;
            }
          }
          if (head < tail && distant[queue[head]] > best) {
            bestIndex = queue[head];
            best = distant[bestIndex];
          }
          row[start] = best;
          if (positions) choices[q * length + start] = bestIndex;
        }
        [next, row] = [row, next];
      }
    }
    let best = 0,
      bestIndex = 0,
      lastSlash = 0;
    for (let j = 0; j <= last[0]; j++) {
      if (slash(at(haystack, j))) lastSlash = j;
      if (!matches(0, j)) continue;
      const factor = penalty(j === 0 ? 1 : (n > 1 ? boundaries[j] : boundary(j)) || f(0.6), 0, j);
      const score = f(f(factor / (length - lastSlash)) * (n > 1 ? next[j + 1] : 1));
      if (score > best) {
        best = score;
        bestIndex = j;
      }
    }
    if (positions && best > 0) {
      positions.push(bestIndex);
      for (let q = 1, start = bestIndex + 1; q < n; q++) {
        const position = choices[q * length + start];
        positions.push(position);
        start = position + 1;
      }
    }
    return f(n * best);
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
    if (size >= MAX_SCORE_CELLS) {
      if (
        maxGap &&
        last.some((position, i) => i > 0 && position - last[i - 1] > maxGap + 1) &&
        !boundedAlignment()
      )
        return 0;
      let score = 1;
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          const gap = last[i] - last[i - 1];
          if (gap > 1) score = f(score * Math.max(f(0.2), f(f(0.6) - f((gap - 1) * f(0.05)))));
        }
        if ((smart || slash(at(haystack, last[i]))) && needle[i] !== at(haystack, last[i]))
          score = f(score * 0.001);
      }
      if (positions) for (const position of last) positions.push(position);
      return f(f(score * n) / length);
    }
    if (dense()) return exact(positions);
    // Sparse paths visit few matching positions; retain their indexOf fast
    // path. Dense candidates use bounded suffix work instead of quadratic scans.
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
module.exports.MAX_SCORE_CELLS = MAX_SCORE_CELLS;
