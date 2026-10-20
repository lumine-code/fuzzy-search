const { Matcher } = require("../lib/main");
const make = (values, options) =>
  new Matcher(
    values.map((_, id) => id),
    values,
    options,
  );
const rank = (query, values) =>
  make(values)
    .match(query, { algorithm: "balanced" })
    .map((r) => r.value);

describe("Balanced alignment", () => {
  for (const [query, candidates, first] of [
    ["main", ["test/domain.js", "src/main.js", "main"], "main"],
    ["fb", ["faraway_broken", "fuzzball", "FooBar"], "FooBar"],
    ["otf", ["OtherFile", "Open The File", "outer_to_faraway_full"], "Open The File"],
    ["main", ["main/other/file.js", "src/main.js"], "src/main.js"],
    ["abc", ["a_long_b_long_c", "abc"], "abc"],
    ["foo-bar", ["fizz/buzz", "foo-bar", "foobar"], "foo-bar"],
  ]) {
    it(`ranks ${first} first for ${query}`, () => {
      expect(rank(query, candidates)[0]).toBe(first);
    });
  }
  it("keeps scores and highlights consistent across expansions and astral characters", () => {
    const m = make(["Straße🙂", "src/Żółć.js", "𐐀𐐁"], { ignoreDiacritics: true });
    for (const [query, id, indexes] of [
      ["strasse🙂", 0, [0, 1, 2, 3, 4, 4, 5, 6, 7]],
      ["zolc", 1, [4, 5, 6, 7]],
      ["𐐨𐐩", 2, [0, 1, 2, 3]],
    ]) {
      const result = m.match(query, { algorithm: "balanced", recordMatchIndexes: true });
      expect(result[0].id).toBe(id);
      expect(result[0].matchIndexes).toEqual(indexes);
      expect(result[0].score).toBeGreaterThan(0);
      expect(result[0].score).toBeLessThanOrEqual(1);
    }
  });
  it("consumes each required character once and keeps separators optional", () => {
    expect(rank("a-a-a", ["aab", "aaa", "a-a-a"]).sort()).toEqual(["a-a-a", "aaa"]);
    expect(rank("abab", ["aabb", "abab"])).toEqual(["abab"]);
  });
  it("finds the optimal alignment against exhaustive short-input enumeration", () => {
    let seed = 13;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const boundary = (word, i) =>
      i === 0 ||
      /[ ._\\/:-]/.test(word[i - 1]) ||
      (/[a-z]/.test(word[i - 1]) && /[A-Z]/.test(word[i]));
    const quality = (word, query, positions) => {
      let score = -Math.min(positions[0], 20);
      for (let j = 0; j < query.length; j++) {
        const i = positions[j];
        if (j) score += i === positions[j - 1] + 1 ? 6 : -(i - positions[j - 1] - 1);
        score +=
          16 + (boundary(word, i) ? 16 + (j === 0 ? 12 : 0) : 0) + (word[i] === query[j] ? 1 : 0);
      }
      return score + (positions.at(-1) === word.length - 1 ? 8 : 0);
    };
    for (let sample = 0; sample < 1000; sample++) {
      const alphabet = "abAB_";
      const word = Array.from(
        { length: 1 + (random() % 12) },
        () => alphabet[random() % alphabet.length],
      ).join("");
      const query = Array.from({ length: 1 + (random() % 4) }, () => "abAB"[random() % 4]).join("");
      let best = -Infinity;
      const enumerate = (positions, from) => {
        if (positions.length === query.length) {
          best = Math.max(best, quality(word, query, positions));
          return;
        }
        for (let i = from; i < word.length; i++)
          if (word[i].toLowerCase() === query[positions.length].toLowerCase())
            enumerate([...positions, i], i + 1);
      };
      enumerate([], 0);
      const result = make([word]).match(query, {
        algorithm: "balanced",
        usePathScoring: false,
        recordMatchIndexes: true,
      });
      if (Number.isFinite(best)) {
        expect(result.length).withContext(`${word}/${query}`).toBe(1);
        if (result.length)
          expect(quality(word, query, result[0].matchIndexes))
            .withContext(`${word}/${query}`)
            .toBe(best);
      } else expect(result).toEqual([]);
    }
  });
});
