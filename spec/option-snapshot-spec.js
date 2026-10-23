const { Matcher } = require("../lib/main");

describe("Prepared Fuzzaldrin option ownership", () => {
  const values = ["src/main.js", "main.js", "src/myFile.h", "src/myFile.html"];
  const ids = values.map((_, id) => id);
  for (const usePathScoring of [false, true]) {
    for (const useExtensionBonus of [false, true]) {
      it(`keeps cached flags independent of the caller (${usePathScoring}/${useExtensionBonus})`, async () => {
        const original = { algorithm: "fuzzaldrin", usePathScoring, useExtensionBonus };
        const callerOptions = { ...original };
        const matcher = new Matcher(ids, values);
        const query = useExtensionBonus ? "mf.h" : "ma";
        // Highlighting prepares a query without caching its full score vector.
        matcher.getMatchIndexes(0, query, callerOptions);
        callerOptions.usePathScoring = !usePathScoring;
        callerOptions.useExtensionBonus = !useExtensionBonus;
        const fresh = new Matcher(ids, values);
        const expected = fresh.match(query, original);
        expect(matcher.match(query, { ...original })).toEqual(expected);
        expect(await matcher.matchIdsAsync(query, { ...original })).toEqual(
          expected.map((item) => item.id),
        );

        const single = new Matcher();
        const singleOptions = { ...original };
        const before = single.matchCandidate(values[0], "ma", singleOptions);
        singleOptions.usePathScoring = !usePathScoring;
        singleOptions.useExtensionBonus = !useExtensionBonus;
        expect(single.matchCandidate(values[0], "ma", { ...original })).toEqual(before);
      });
    }
  }
});

describe("Asynchronous request option ownership", () => {
  const values = ["src/main.js", "main.js", "src/myFile.h", "src/myFile.html", "MaIn.js"];
  const create = () =>
    new Matcher(
      values.map((_, id) => id),
      values,
    );

  for (const algorithm of ["command-t", "fuzzaldrin"]) {
    it(`captures options before yielding for ${algorithm}`, async () => {
      const matcher = create();
      const options = {
        algorithm,
        caseSensitive: true,
        smartCase: true,
        maxGap: 2,
        usePathScoring: true,
        useExtensionBonus: false,
        maxResults: 3,
        rootPath: "src",
        scoreModifier: (score, id) => (id === 0 ? 0 : score),
      };
      const expected = create().matchIds("ma", options);
      expect(expected.length).toBeGreaterThan(0);
      const first = matcher.matchIdsAsync("ma", options);
      Object.assign(options, {
        algorithm: algorithm === "command-t" ? "fuzzaldrin" : "command-t",
        caseSensitive: false,
        smartCase: false,
        maxGap: 1,
        usePathScoring: false,
        useExtensionBonus: true,
        maxResults: 1,
        rootPath: "other",
        scoreModifier: () => 0,
      });
      const second = matcher.matchIdsAsync("ma", options);
      expect(await first).toEqual(expected);
      expect(await second).toEqual([]);
      expect(matcher.matchIds("ma", options)).toEqual([]);
    });
  }

  it("captures supported inherited options as well as own properties", async () => {
    const defaults = { algorithm: "fuzzaldrin", maxResults: 1 };
    const options = Object.create(defaults);
    const expected = create().matchIds("ma", options);
    const pending = create().matchIdsAsync("ma", options);
    defaults.maxResults = 0;
    defaults.algorithm = "command-t";
    expect(await pending).toEqual(expected);
  });

  it("captures scoring flags for a worker score scan before yielding", async () => {
    const options = { algorithm: "fuzzaldrin", usePathScoring: true, useExtensionBonus: true };
    const expected = await create().scanAsync("mf.h", options);
    const pending = create().scanAsync("mf.h", options);
    options.algorithm = "command-t";
    options.usePathScoring = false;
    options.useExtensionBonus = false;
    const actual = await pending;
    expect(actual.signature).toBe(expected.signature);
    expect(Array.from(actual.raw)).toEqual(Array.from(expected.raw));
  });

  it("continues rejecting invalid options instead of treating them as defaults", async () => {
    for (const options of [null, false, 1, "fuzzaldrin"]) {
      await expectAsync(create().matchIdsAsync("ma", options)).toBeRejectedWithError(
        "Second argument should be an options object",
      );
    }
  });
});
