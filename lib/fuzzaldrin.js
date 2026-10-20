// Port of fuzzy-native's fuzzaldrin-plus/zadeh implementation.
// Inherited MIT/Apache-2.0 notices are retained in THIRD_PARTY_NOTICES.
const { at, slash, separator } = require("./text");
const f = Math.fround;
const eq = (a, b) => a === b || (slash(a) && slash(b));
const positionScore = (p) => (p < 20 ? 100 + (20 - p) ** 2 : Math.max(120 - p, 0));
const sizeScore = (n, m) => f(150 / f(150 + Math.abs(f(m - n))));
const exactScore = (n, m, quality, p) =>
  f(f(2 * n * f(f(150 * quality) + positionScore(p))) * sizeScore(n, m));
function patternScore(count, len, sameCase, start, end) {
  let size = count,
    bonus = 6 + (sameCase === count ? 2 : 0) + (start ? 3 : 0) + (end ? 1 : 0);
  if (count === len) {
    if (start) size += sameCase === len ? 2 : 1;
    if (end) bonus++;
  }
  return sameCase + size * (size + bonus);
}
function countDirs(codes, end = codes.length) {
  if (end < 1) return 0;
  let count = 0,
    i = 0;
  while (i < end && slash(at(codes, i))) i++;
  i++;
  while (i < end) {
    if (slash(at(codes, i))) {
      count++;
      i++;
      while (i < end && slash(at(codes, i))) i++;
    }
    i++;
  }
  return count;
}
function lastSlash(codes, from) {
  for (let i = Math.max(0, Math.min(from, codes.length - 1)); i >= 0; i--)
    if (slash(at(codes, i))) return i;
  return -1;
}
function find(codes, needle, from, end) {
  for (let i = from; i + needle.length <= end; i++) {
    let j = 0;
    while (j < needle.length && eq(at(codes, i + j), needle[j])) j++;
    if (j === needle.length) return i;
  }
  return -1;
}
function extensionScore(codes, ext, start, end, depth) {
  if (!ext.length || end < 0) return 0;
  let dot = end;
  while (dot >= 0 && at(codes, dot) !== 46) dot--;
  if (dot <= start) return 0;
  const n = Math.min(ext.length, end - dot),
    m = Math.max(ext.length, end - dot);
  let matched = 0;
  while (matched < n && at(codes, dot + 1 + matched) === ext[matched]) matched++;
  if (!matched && depth > 0)
    return f(f(0.9) * extensionScore(codes, ext, start, dot - 1, depth - 1));
  return f(matched / m);
}

module.exports = function createScorer(query, options) {
  const q = query.codes,
    ql = query.folded,
    n = q.length;
  const core = ql.filter((c) => c !== 32 && c !== 95 && c !== 45 && c !== 58 && !slash(c));
  const chars = new Set(ql);
  if (chars.has(47) || chars.has(92)) {
    chars.add(47);
    chars.add(92);
  }
  const asciiChars = new Uint8Array(128);
  for (const c of chars) if (c < 128) asciiChars[c] = 1;
  const coreChars = Array.from(core, (c) => String.fromCodePoint(c));
  const queryChars = Array.from(ql, (c) => String.fromCodePoint(c));
  const scanChars = Array.from(chars, (c) => String.fromCodePoint(c));
  const queryDepth = countDirs(q),
    ext = ql.slice(ql.lastIndexOf(46) + 1);
  const queryExt = ql.includes(46) ? ext : new Uint32Array();
  const row = new Float32Array(n),
    consecutiveRow = new Float32Array(n);
  let trace = new Uint8Array(0);
  const basenames = new Map();
  let basenameUnits = 0;
  const starts = (t, i) =>
    t.ascii && !query.ascii
      ? separator(at(t.codes, i - 1)) ||
        (at(t.codes, i - 1) >= 97 &&
          at(t.codes, i - 1) <= 122 &&
          at(t.codes, i) >= 65 &&
          at(t.codes, i) <= 90)
      : t.starts[i];
  const ends = (t, i) =>
    t.ascii && !query.ascii
      ? separator(at(t.codes, i + 1)) ||
        (at(t.codes, i) >= 97 &&
          at(t.codes, i) <= 122 &&
          at(t.codes, i + 1) >= 65 &&
          at(t.codes, i + 1) <= 90)
      : t.ends[i];

  function acronym(t, from, end) {
    if (end - from <= 1 || n <= 1) return { score: 0, pos: 0.1, count: 0 };
    let count = 0,
      sepCount = 0,
      sum = 0,
      same = 0,
      i = from - 1;
    for (let j = 0; j < n; j++) {
      if (separator(ql[j])) {
        do {
          i++;
        } while (i < end && !eq(at(t.folded, i), ql[j]));
        if (i < end) {
          sepCount++;
          continue;
        }
        break;
      }
      while (i < end) {
        if (typeof t.folded === "string") {
          i = t.folded.indexOf(queryChars[j], i + 1);
          if (i < 0 || i >= end) {
            i = end;
            break;
          }
        } else if (++i >= end) break;
        if (ql[j] === at(t.folded, i) && (i === from || starts(t, i))) {
          if (q[j] === at(t.codes, i)) same++;
          sum += i - from;
          count++;
          break;
        }
      }
      if (i === end) break;
    }
    if (count < 2) return { score: 0, pos: 0.1, count: 0 };
    let full = count === n && end - from <= 12 * count;
    if (full) {
      let boundaries = 0;
      for (let i = from; i < end; i++)
        if ((i === from || starts(t, i)) && ++boundaries > count) {
          full = false;
          break;
        }
    }
    return {
      score: patternScore(count, n, same, true, full),
      pos: f(sum / count),
      count: count + sepCount,
    };
  }
  function consecutives(t, i, j, start, end) {
    let same = eq(q[j], at(t.codes, i)) ? 1 : 0,
      size = 1;
    const limit = Math.min(end - i, n - j);
    while (size < limit && eq(ql[++j], at(t.folded, ++i))) {
      if (eq(q[j], at(t.codes, i))) same++;
      size++;
    }
    if (size < limit) i--;
    if (size === 1) return 1 + 2 * same;
    return patternScore(size, n, same, start, i === end - 1 || ends(t, i));
  }
  function compute(t, from = 0, end = t.codes.length) {
    if (!n || end <= from) return 0;
    const acro = acronym(t, from, end);
    if (acro.count === n) return exactScore(n, end - from, acro.score, acro.pos);
    const locate = (from) => {
      if (t.search !== null && query.search !== null) {
        const at = t.search.indexOf(query.search, from);
        return at >= 0 && at + n <= end ? at : -1;
      }
      return find(t.folded, ql, from, end);
    };
    let pos = locate(from);
    if (pos >= 0) {
      let start = pos === from || starts(t, pos);
      if (!start) {
        const second = locate(pos + 1);
        if (second >= 0 && starts(t, second)) {
          start = true;
          pos = second;
        }
      }
      let same = 0;
      for (let j = 0; j < n; j++) if (eq(q[j], at(t.codes, pos + j))) same++;
      const wordEnd = pos + n === end || ends(t, pos + n - 1);
      const basename = start && pos > from && slash(at(t.codes, pos - 1)) ? 1.1 : 1;
      return exactScore(
        n,
        end - from,
        f(f(basename) * patternScore(n, n, same, start, wordEnd)),
        pos - from,
      );
    }
    row.fill(0);
    consecutiveRow.fill(0);
    const size = sizeScore(n, end - from),
      budget = Math.ceil(0.75 * n) + 5;
    let left = budget,
      rebuild = true;
    for (let i = from; i < end; i++) {
      if (typeof t.folded === "string" && scanChars.length <= 4) {
        let next = end;
        for (const character of scanChars) {
          const found = t.folded.indexOf(character, i);
          if (found >= 0 && found < next) next = found;
        }
        if (next === end) break;
        if (next > i) {
          consecutiveRow.fill(0);
          i = next;
        }
      }
      const c = at(t.folded, i);
      if (!(c < 128 ? asciiChars[c] : chars.has(c))) {
        if (rebuild) {
          consecutiveRow.fill(0);
          rebuild = false;
        }
        continue;
      }
      let score = 0,
        diagonal = 0,
        consecutiveDiagonal = 0,
        recordMiss = true;
      rebuild = true;
      for (let j = 0; j < n; j++) {
        const up = row[j];
        if (up > score) score = up;
        let consecutive = 0;
        if (eq(ql[j], c)) {
          const start = i === from || starts(t, i);
          consecutive =
            consecutiveDiagonal > 0 ? consecutiveDiagonal : consecutives(t, i, j, start, end);
          const align = f(
            diagonal +
              f(
                positionScore(i - from) +
                  150 * (start ? Math.max(acro.score, consecutive) + 10 : consecutive),
              ),
          );
          if (align > score) {
            score = align;
            left = budget;
          } else {
            if (recordMiss && --left <= 0) return f(Math.max(score, row[n - 1]) * size);
            recordMiss = false;
          }
        }
        diagonal = up;
        consecutiveDiagonal = consecutiveRow[j];
        consecutiveRow[j] = consecutive;
        row[j] = score;
      }
    }
    return f(row[n - 1] * size);
  }
  const ceiling = Math.max(1, Math.ceil(compute(query)));
  function score(t) {
    if (!t.codes.length || core.length > t.codes.length) return 0;
    let i = 0;
    if (t.search !== null && query.search !== null) {
      for (let j = 0; j < core.length; j++) {
        i = t.search.indexOf(coreChars[j], i);
        if (i < 0) return 0;
        i++;
      }
    } else
      for (let j = 0; j < core.length; j++) {
        while (i < t.folded.length && !eq(at(t.folded, i), core[j])) i++;
        if (i === t.folded.length) return 0;
        i++;
      }
    let full = compute(t);
    if (full && options.usePathScoring !== false) {
      let end = t.codes.length - 1;
      while (end >= 0 && slash(at(t.codes, end))) end--;
      if (end >= 0) {
        let base = lastSlash(t.codes, end);
        const fileLength = end - base;
        const adjust = options.useExtensionBonus
          ? f(1 + extensionScore(t.folded, queryExt, base, end, 2))
          : 1;
        full = f(full * adjust);
        if (base !== -1) {
          for (let depth = queryDepth; base > -1 && depth-- > 0;)
            base = lastSlash(t.codes, base - 1);
          let baseScore = full;
          if (base !== -1) {
            const key = typeof t.codes === "string" ? t.codes.slice(base + 1, end + 1) : null;
            let computed = key === null ? undefined : basenames.get(key);
            if (computed === undefined) {
              computed = compute(t, base + 1, end + 1);
              if (key !== null && basenames.size < 2048 && basenameUnits + key.length <= 65536) {
                basenames.set(key, computed);
                basenameUnits += key.length;
              }
            }
            baseScore = f(adjust * computed);
          }
          const alpha = f(10 / (20 + countDirs(t.codes, end + 1)));
          full = f(
            f(alpha * baseScore) + f(f(f(1 - alpha) * full) * sizeScore(0, 2.5 * fileLength)),
          );
        }
      }
    }
    return Math.ceil(full);
  }
  function computeIndexes(t, from = 0, end = t.codes.length) {
    if (!n || end <= from) return [];
    if ((end - from) * n > 2 ** 22) {
      const result = [];
      let i = from;
      for (const c of ql) {
        while (i < end && !eq(at(t.folded, i), c)) i++;
        if (i === end) break;
        result.push(i++);
      }
      return result;
    }
    const acro = acronym(t, from, end);
    row.fill(0);
    consecutiveRow.fill(0);
    const size = (end - from) * n;
    if (trace.length < size) trace = new Uint8Array(size);
    let pos = 0;
    for (let i = from; i < end; i++) {
      let score = 0,
        up = 0,
        consecutiveDiagonal = 0;
      for (let j = 0; j < n; j++) {
        let consecutive = 0,
          align = 0;
        const diagonal = up;
        if (eq(ql[j], at(t.folded, i))) {
          const start = i === from || starts(t, i);
          consecutive =
            consecutiveDiagonal > 0 ? consecutiveDiagonal : consecutives(t, i, j, start, end);
          align = f(
            diagonal +
              f(
                positionScore(i - from) +
                  150 * (start ? Math.max(acro.score, consecutive) + 10 : consecutive),
              ),
          );
        }
        up = row[j];
        consecutiveDiagonal = consecutiveRow[j];
        let move = 2;
        if (score <= up) {
          score = up;
          move = 1;
        }
        if (align > score) {
          score = align;
          move = 3;
        } else consecutive = 0;
        row[j] = score;
        consecutiveRow[j] = consecutive;
        trace[pos++] = score > 0 ? move : 0;
      }
    }
    const matches = [];
    let i = end - from - 1,
      j = n - 1;
    while (i >= 0 && j >= 0) {
      const move = trace[i * n + j];
      if (move === 1) i--;
      else if (move === 2) j--;
      else if (move === 3) {
        matches.push(i + from);
        i--;
        j--;
      } else break;
    }
    return matches.reverse();
  }
  function indexes(t) {
    const full = computeIndexes(t);
    let end = t.codes.length - 1;
    while (end >= 0 && slash(at(t.codes, end))) end--;
    if (end < 0) return full;
    let base = lastSlash(t.codes, end);
    if (base === -1) return full;
    for (let depth = queryDepth; depth-- > 0;) {
      base = lastSlash(t.codes, base - 1);
      if (base === -1) return full;
    }
    const extra = computeIndexes(t, base + 1, end + 1);
    return [...new Set([...full, ...extra])].sort((a, b) => a - b);
  }
  return { score, indexes, ceiling, core };
};
