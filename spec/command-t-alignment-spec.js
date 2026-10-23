const { Matcher } = require("../lib/main");

// Independent enumeration of the scoring contract. This deliberately scans
// every possible next match; production must not pay that cost on dense text.
function reference(value, query, options) {
  const f = Math.fround;
  const slash = (c) => c === "/" || c === "\\";
  const folded = options.caseSensitive ? value : value.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const smart = !options.caseSensitive && options.smartCase && /[A-Z]/.test(query);
  const memo = new Map();
  function visit(start, q) {
    if (q === query.length) return { score: 1, positions: [] };
    const key = `${start}/${q}`;
    if (memo.has(key)) return memo.get(key);
    let best = { score: 0, positions: [] };
    const end =
      q && options.maxGap ? Math.min(value.length, start + options.maxGap + 1) : value.length;
    for (let j = start; j < end; j++) {
      if (needle[q] !== folded[j] && !(slash(folded[j]) && (needle[q] === "_" || slash(needle[q]))))
        continue;
      let factor = 1;
      if (j > start) {
        const previous = value[j - 1];
        if (slash(previous)) factor = f(0.9);
        else if (/[-_ 0-9]/.test(previous) || (/[a-z]/.test(previous) && /[A-Z]/.test(value[j])))
          factor = f(0.8);
        else if (previous === ".") factor = f(0.7);
        else factor = q ? Math.max(f(0.2), f(f(0.6) - f((j - start - 1) * f(0.05)))) : f(0.6);
      }
      if ((smart || slash(value[j])) && query[q] !== value[j]) factor = f(factor * 0.001);
      if (q === 0)
        factor = f(
          factor /
            (value.length - Math.max(0, value.lastIndexOf("/", j), value.lastIndexOf("\\", j))),
        );
      const suffix = visit(j + 1, q + 1);
      const score = f(factor * suffix.score);
      if (score > best.score) best = { score, positions: [j, ...suffix.positions] };
    }
    memo.set(key, best);
    return best;
  }
  const result = visit(0, 0);
  return { score: f(query.length * result.score), positions: result.positions };
}

describe("Dense Command-T alignment", () => {
  it("keeps the exact score on the former worst-case input", () => {
    const value = "a".repeat(908) + "b";
    const query = "a".repeat(10) + "b";
    const matcher = new Matcher([0], [value]);
    const [result] = matcher.match(query, { recordMatchIndexes: true });
    expect(result.score).toBe(0.007260726299136877);
    expect(result.matchIndexes).toEqual(Array.from({ length: 11 }, (_, i) => i + 898));
  });

  it("agrees with exhaustive suffix search for scores, gap bounds and tie alignments", () => {
    let seed = 0x12345678;
    const random = (n) => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % n;
    };
    for (let sample = 0; sample < 96; sample++) {
      const alphabet = "aaaabbAB/_- .1";
      const value = Array.from(
        { length: 128 + random(64) },
        () => alphabet[random(alphabet.length)],
      ).join("");
      const query = ["ab", "aab", "Ab", "a_b", "a/b", "a\\b"][sample % 6];
      const options = {
        caseSensitive: sample % 4 === 0,
        smartCase: sample % 4 === 1,
        maxGap: [0, 1, 8, 9, 10, 11, 20, 100][Math.floor(sample / 6) % 8],
        recordMatchIndexes: true,
      };
      const expected = reference(value, query, options);
      const actual = new Matcher([0], [value]).match(query, options)[0];
      expect(actual?.score ?? 0)
        .withContext(JSON.stringify({ sample, query, options }))
        .toBe(expected.score);
      if (actual)
        expect(actual.matchIndexes).withContext(`sample ${sample}`).toEqual(expected.positions);
    }
  });
});
