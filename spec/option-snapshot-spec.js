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
