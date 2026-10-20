// Unicode 17 simple folding and properties, independent of the host ICU version.
// Copyright Unicode, Inc.; see THIRD_PARTY_NOTICES and the pinned generator inputs.
const data = require("./unicode-data.json");
const diacritics = require("./diacritics-data.json");
const slash = (c) => c === 47 || c === 92;
const separator = (c) => c === 32 || c === 46 || c === 45 || c === 95 || slash(c);
const at = (text, index) => (typeof text === "string" ? text.charCodeAt(index) : text[index]);
function inRanges(c, ranges) {
  let lo = 0,
    hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid][1] < c) lo = mid + 1;
    else hi = mid;
  }
  return lo < ranges.length && ranges[lo][0] <= c;
}
const upper = (c) =>
  c < 128 ? c >= 65 && c <= 90 : inRanges(c, data.Uppercase) || inRanges(c, data.Titlecase);
const lower = (c) => (c < 128 ? c >= 97 && c <= 122 : inRanges(c, data.Lowercase));
const fold = (c) => (c < 128 ? (c >= 65 && c <= 90 ? c + 32 : c) : (data.folds[c] ?? c));
function wordStart(text, index, unicode = false) {
  if (!index) return true;
  if (!text.ascii) return text.starts[index];
  const previous = at(text.codes, index - 1),
    current = at(text.codes, index);
  return (
    separator(previous) ||
    (current >= 65 &&
      current <= 90 &&
      (unicode ? previous >= 97 && previous <= 122 : !(previous >= 65 && previous <= 90)))
  );
}
function wordEnd(text, index, unicode = false) {
  if (index === text.codes.length - 1) return true;
  if (!text.ascii) return text.ends[index];
  const current = at(text.codes, index),
    next = at(text.codes, index + 1);
  return (
    separator(next) ||
    (next >= 65 &&
      next <= 90 &&
      (unicode ? current >= 97 && current <= 122 : !(current >= 65 && current <= 90)))
  );
}
function withPathMetadata(text) {
  const codes = text.codes;
  let end = codes.length - 1;
  while (end >= 0 && slash(at(codes, end))) end--;
  let base = -1,
    depth = 0,
    seen = false,
    inSeparator = false;
  for (let i = 0; i <= end; i++) {
    if (slash(at(codes, i))) {
      base = i;
      if (seen && !inSeparator) depth++;
      inSeparator = true;
    } else {
      seen = true;
      inSeparator = false;
    }
  }
  text.pathEnd = end;
  text.pathBase = base;
  text.pathDepth = depth;
  text.basename = base >= 0 && typeof codes === "string" ? codes.slice(base + 1, end + 1) : null;
  return text;
}

function prepareAscii(value, codes, folded) {
  let mask = 0,
    dirs = 0;
  for (let i = 0; i < folded.length; i++) {
    const c = folded.charCodeAt(i);
    if (slash(c)) dirs++;
    if (c >= 97 && c <= 122) mask |= 1 << (c - 97);
  }
  return withPathMetadata({
    value,
    codes,
    folded,
    starts: null,
    ends: null,
    offsets: null,
    widths: null,
    mask,
    dirs,
    ascii: true,
    search: folded.replaceAll("\\", "/"),
  });
}

function prepare(value, ignoreDiacritics = false) {
  // eslint-disable-next-line no-control-regex -- classify the complete ASCII range
  if (!/[^\x00-\x7f]/.test(value)) {
    const folded = value.toLowerCase();
    const codes = ignoreDiacritics ? folded : value;
    return prepareAscii(value, codes, folded);
  }
  if (ignoreDiacritics) {
    let needsOffsets = false;
    // The pinned diacritic table contains only lowercase ASCII replacements.
    // Common one-code-unit substitutions need no per-character offset arrays.
    // eslint-disable-next-line no-control-regex -- process non-ASCII code points
    const normalized = value.replace(/[^\x00-\x7f]/gu, (character) => {
      const replacement = diacritics[character.codePointAt(0)];
      if (replacement === undefined) return character;
      if (character.length !== 1 || replacement.length !== 1) needsOffsets = true;
      return replacement;
    });
    // eslint-disable-next-line no-control-regex -- retain unmatched Unicode
    if (!needsOffsets && !/[^\x00-\x7f]/.test(normalized)) {
      const folded = normalized.toLowerCase();
      return prepareAscii(value, folded, folded);
    }
  }
  const chars = [],
    offsets = [],
    widths = [];
  for (let i = 0; i < value.length;) {
    let cp = value.codePointAt(i);
    const width = cp > 65535 ? 2 : 1;
    // N-API's UTF-8 conversion replaces lone surrogates.
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    const replacement = ignoreDiacritics ? diacritics[cp] : undefined;
    if (replacement !== undefined) {
      for (const ch of replacement) {
        chars.push(ch.codePointAt(0));
        offsets.push(i);
        widths.push(1);
      }
    } else {
      chars.push(ignoreDiacritics && cp < 128 ? fold(cp) : cp);
      offsets.push(i);
      widths.push(width);
    }
    i += width;
  }
  if (chars.every((c) => c < 128)) {
    // Accent folding frequently leaves a wholly ASCII path. Keep that path on
    // the same compact/string-search scorer as an originally ASCII candidate.
    let codes = "";
    for (let i = 0; i < chars.length; i += 8192)
      codes += String.fromCharCode(...chars.slice(i, i + 8192));
    const folded = codes.toLowerCase();
    let mask = 0,
      dirs = 0;
    for (let i = 0; i < codes.length; i++) {
      if (slash(codes.charCodeAt(i))) dirs++;
      const c = folded.charCodeAt(i);
      if (c >= 97 && c <= 122) mask |= 1 << (c - 97);
    }
    const identity =
      value.length === chars.length &&
      offsets.every((offset, i) => offset === i && widths[i] === 1);
    return withPathMetadata({
      value,
      codes,
      folded,
      starts: null,
      ends: null,
      offsets: identity ? null : offsets,
      widths: identity ? null : widths,
      mask,
      dirs,
      ascii: true,
      search: folded.replaceAll("\\", "/"),
    });
  }
  const codes = Uint32Array.from(chars),
    folded = Uint32Array.from(chars, fold);
  const starts = new Uint8Array(chars.length),
    ends = new Uint8Array(chars.length);
  let mask = 0,
    dirs = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i],
      prev = chars[i - 1],
      next = chars[i + 1];
    starts[i] = i === 0 || separator(prev) || (lower(prev) && upper(c));
    ends[i] = i === chars.length - 1 || separator(next) || (lower(c) && upper(next));
    if (slash(c)) dirs++;
    const f = folded[i];
    if (f >= 97 && f <= 122) mask |= 1 << (f - 97);
  }
  return withPathMetadata({
    value,
    codes,
    folded,
    starts,
    ends,
    offsets,
    widths,
    mask,
    dirs,
    ascii: false,
    search: null,
  });
}
function indexes(text, positions) {
  if (!text.offsets) return positions;
  const result = [];
  let previous = -1;
  for (const p of positions) {
    if (p === previous || p < 0 || p >= text.codes.length) continue;
    previous = p;
    result.push(text.offsets[p]);
    if (text.widths[p] === 2) result.push(text.offsets[p] + 1);
  }
  return result;
}
module.exports = { prepare, indexes, slash, separator, upper, lower, at, wordStart, wordEnd };
