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

function prepare(value, ignoreDiacritics = false) {
  // eslint-disable-next-line no-control-regex -- classify the complete ASCII range
  if (!/[^\x00-\x7f]/.test(value)) {
    const length = value.length;
    const folded = value.toLowerCase();
    const codes = ignoreDiacritics ? folded : value;
    const starts = new Uint8Array(length),
      ends = new Uint8Array(length);
    let mask = 0,
      dirs = 0;
    for (let i = 0; i < length; i++) {
      const original = value.charCodeAt(i);
      const c = ignoreDiacritics && original >= 65 && original <= 90 ? original + 32 : original;
      const prev = i ? codes.charCodeAt(i - 1) : 0;
      const f = c >= 65 && c <= 90 ? c + 32 : c;
      const transition = !(prev >= 65 && prev <= 90) && c >= 65 && c <= 90;
      starts[i] = i === 0 || separator(prev) || transition;
      if (i) ends[i - 1] = separator(c) || transition;
      if (slash(c)) dirs++;
      if (f >= 97 && f <= 122) mask |= 1 << (f - 97);
    }
    if (length) ends[length - 1] = 1;
    return {
      value,
      codes,
      folded,
      starts,
      ends,
      offsets: null,
      widths: null,
      mask,
      dirs,
      ascii: true,
      search: value.toLowerCase().replaceAll("\\", "/"),
    };
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
  const ascii = chars.every((c) => c < 128);
  // Diacritic folding may turn a Unicode candidate into the ASCII fast path.
  if (ascii)
    for (let i = 0; i < chars.length; i++) {
      const transition =
        chars[i] >= 65 && chars[i] <= 90 && !(chars[i - 1] >= 65 && chars[i - 1] <= 90);
      starts[i] = i === 0 || separator(chars[i - 1]) || transition;
      if (i) ends[i - 1] = separator(chars[i]) || transition;
    }
  return {
    value,
    codes,
    folded,
    starts,
    ends,
    offsets,
    widths,
    mask,
    dirs,
    ascii,
    search: ascii
      ? Array.from(folded, (c) => String.fromCharCode(c))
          .join("")
          .replaceAll("\\", "/")
      : null,
  };
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
module.exports = { prepare, indexes, slash, separator, upper, lower, at };
