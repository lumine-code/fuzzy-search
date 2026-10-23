const { Matcher } = require("../lib/main");

const create = (values, ignoreDiacritics = false) =>
  new Matcher(
    values.map((_, id) => id),
    values,
    { ignoreDiacritics },
  );

describe("Fuzzy ranking quality", () => {
  for (const ignoreDiacritics of [false, true]) {
    it(`finds a better third literal occurrence with accent folding ${ignoreDiacritics}`, () => {
      const matcher = create(["afoo afoo foo", "axxx axxx foo"], ignoreDiacritics);
      const results = matcher.match("foo", { algorithm: "fuzzaldrin", recordMatchIndexes: true });
      expect(results.map((row) => row.id)).toEqual([0, 1]);
      expect(results[0].score).toBe(results[1].score);
      expect(results[0].matchIndexes).toEqual([10, 11, 12]);
    });
  }

  it("compares word endings and case at all literal occurrences", () => {
    for (const [value, query, reference] of [
      ["foofoo foo", "foo", "xxxxxx foo"],
      ["FOO FOO foo", "foo", "xxx xxx foo"],
      ["src/latest-latest-test.js", "test", "src/laxxxx-laxxxx-test.js"],
    ]) {
      const matcher = create([value, reference]);
      const result = matcher.match(query, { algorithm: "fuzzaldrin" });
      expect(result[0].id).withContext(value).toBe(0);
      expect(result[0].score).withContext(value).toBeGreaterThanOrEqual(result[1].score);
    }
  });

  for (const algorithm of ["command-t", "fuzzaldrin"]) {
    it(`preserves camelCase bonuses while folding accents with ${algorithm}`, async () => {
      for (const values of [
        ["foobar", "FooBar"],
        ["zolccma", "ŻółćĆma"],
        ["strassebaum", "StraßeBaum"],
      ]) {
        const query = values[0].startsWith("foo")
          ? "fb"
          : values[0].startsWith("zolc")
            ? "zc"
            : "sb";
        const matcher = create(values, true);
        const options = { algorithm, recordMatchIndexes: true };
        const results = matcher.match(query, options);
        expect(results.map((row) => row.id))
          .withContext(values.join(","))
          .toEqual([1, 0]);
        expect(results[0].score).toBeGreaterThan(results[1].score);
        expect(await matcher.matchIdsAsync(query, options)).toEqual([1, 0]);
        expect(matcher.matchCandidate(values[1], query, options).score).toBe(results[0].score);
        expect(matcher.getMatchIndexes(1, query, options)).toEqual(results[0].matchIndexes);
      }
    });
  }

  it("preserves case-sensitive and smart-case comparisons during accent folding", () => {
    const matcher = create(["Zolc", "Żółć", "żółć"], true);
    expect(matcher.matchIds("Z", { caseSensitive: true })).toEqual([0, 1]);
    expect(matcher.matchIds("z", { caseSensitive: true })).toEqual([2]);
    const result = matcher.match("Ż", { smartCase: true });
    expect(result.map((row) => row.id)).toEqual([0, 1, 2]);
    expect(result[1].score).toBeGreaterThan(result[2].score * 100);
  });
});
