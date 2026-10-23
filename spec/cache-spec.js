const { Matcher } = require("../lib/main");
const create = (values, options) =>
  new Matcher(
    values.map((_, id) => id),
    values,
    options,
  );

describe("Prepared query integration", () => {
  for (const algorithm of ["command-t", "fuzzaldrin"]) {
    it(`keeps top-N and ID-only results equivalent to the full ordering with ${algorithm}`, () => {
      const values = Array.from({ length: 500 }, (_, id) => `src/${id % 7}/my-file-${id}.js`);
      const matcher = create(values);
      const all = matcher.match("mf", { algorithm });
      for (const maxResults of [1, 30, 200, 700, 0]) {
        const expected = maxResults ? all.slice(0, maxResults) : all;
        expect(matcher.match("mf", { algorithm, maxResults })).toEqual(expected);
        expect(create(values).match("mf", { algorithm, maxResults })).toEqual(expected);
        expect(matcher.matchIds("mf", { algorithm, maxResults })).toEqual(
          expected.map((r) => r.id),
        );
      }
    });
    it(`rescans dynamic modifiers before top-N selection with ${algorithm}`, () => {
      const matcher = create(["main.js", "src/main.js", "test/main.js"]);
      let wanted = 2;
      const options = {
        algorithm,
        maxResults: 1,
        scoreModifier: (score, id) => (id === wanted ? score * 100 : 0),
      };
      expect(matcher.matchIds("main", options)).toEqual([2]);
      wanted = 1;
      expect(matcher.matchIds("main", options)).toEqual([1]);
      expect(matcher.matchIds("main", { algorithm })).toContain(0);
    });
    it(`invalidates scores after every candidate mutation with ${algorithm}`, () => {
      const m = create(["abc", "def"]);
      expect(m.matchIds("a", { algorithm })).toEqual([0]);
      m.addCandidates([2], ["ab"]);
      expect(m.matchIds("ab", { algorithm }).sort()).toEqual([0, 2]);
      m.removeCandidates([0]);
      expect(m.matchIds("abc", { algorithm })).toEqual([]);
      m.setCandidates([5], ["abc"]);
      expect(m.matchIds("abc", { algorithm })).toEqual([5]);
    });
    it(`keeps highlight-only queries from corrupting narrowing with ${algorithm}`, () => {
      const m = create(["abc", "def"]);
      m.match("d", { algorithm });
      expect(m.getMatchIndexes(0, "ab", { algorithm })).toEqual([0, 1]);
      expect(m.matchIds("abc", { algorithm })).toEqual([0]);
      expect(m.getMatchIndexes(1, "abc", { algorithm })).toBeNull();
    });
    it(`keeps unchanged snapshots valid while evaluating fresh modifiers with ${algorithm}`, () => {
      const values = ["alpha", "alphabet"];
      const m = create(values);
      let selected = 0;
      const options = { algorithm, scoreModifier: (score, id) => (id === selected ? score : 0) };
      expect(m.matchIds("al", options)).toEqual([0]);
      m.setCandidates([0, 1], values.slice());
      selected = 1;
      expect(m.matchIds("al", options)).toEqual([1]);
      m.setCandidates([1, 0, 1], ["alpha", "changed", "ignored duplicate"]);
      const expected = new Matcher([1, 0], ["alpha", "changed"]);
      const trace = { algorithm, recordMatchIndexes: true };
      expect(m.match("al", trace)).toEqual(expected.match("al", trace));
      expect(m.getMatchIndexes(0, "changed", trace)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
    it(`does not expose mutable cached results with ${algorithm}`, () => {
      const m = create(["abc"]);
      const options = { algorithm, recordMatchIndexes: true };
      const result = m.match("ab", options);
      result[0].score = -1;
      result[0].matchIndexes.push(99);
      result.length = 0;
      expect(m.match("ab", options)[0].score).toBeGreaterThan(0);
      expect(m.match("ab", options)[0].matchIndexes).toEqual([0, 1]);
    });
    it(`handles changing roots, options, shrinking and optional queries with ${algorithm}`, () => {
      const values = ["abc", "Abc", "x/abc", "y/abc", "def", "a-b"];
      const m = create(values);
      for (const query of ["a", "ab", "abc", "ab", "A", "-", "-ab", ""]) {
        for (const extra of [
          {},
          { rootPath: "y" },
          { caseSensitive: true },
          { smartCase: true },
          { maxGap: 1 },
        ]) {
          const options = { algorithm, ...extra };
          expect(m.match(query, options)).toEqual(create(values).match(query, options));
        }
      }
    });
  }
  it("keeps smart case based on the original query before diacritic expansion", () => {
    const m = create(["ßKk"], { ignoreDiacritics: true });
    const result = m.match("K", { smartCase: true, recordMatchIndexes: true });
    // Accent folding retains the uppercase Kelvin sign's case; the trailing
    // lowercase k must not displace the same-case match.
    expect(result[0].matchIndexes).toEqual([1]);
  });
  it("validates mutations before changing the candidate set", () => {
    const m = create(["abc"]);
    expect(() => m.setCandidates([1, 2], ["def", null])).toThrow();
    expect(m.matchIds("abc")).toEqual([0]);
    expect(() => m.addCandidates([1, -1], ["def", "ghi"])).toThrow();
    expect(m.matchIds("def")).toEqual([]);
  });
});
