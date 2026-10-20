const { Matcher } = require("../lib/main");

describe("Prepared accent-insensitive candidates", () => {
  for (const algorithm of ["command-t", "fuzzaldrin"]) {
    it(`preserves original offsets after compact folding with ${algorithm}`, () => {
      const m = new Matcher([0, 1, 2], ["Żółć", "Æß", "Straße"], { ignoreDiacritics: true });
      const options = { algorithm, recordMatchIndexes: true };
      expect(m.match("zolc", options)[0].matchIndexes).toEqual([0, 1, 2, 3]);
      expect(m.match("aess", options)[0].matchIndexes).toEqual([0, 0, 1, 1]);
      expect(m.match("strasse", options)[0].matchIndexes).toEqual([0, 1, 2, 3, 4, 4, 5]);
      expect(m.getMatchIndexes(0, "zolc", options)).toEqual([0, 1, 2, 3]);
      expect(m.match("missing", options)).toEqual([]);
    });
  }

  it("keeps offsets across Unicode that is not transliterated", () => {
    const m = new Matcher([0], ["z🙂ó"], { ignoreDiacritics: true });
    expect(
      m.match("zo", { algorithm: "command-t", recordMatchIndexes: true })[0].matchIndexes,
    ).toEqual([0, 3]);
  });

  it("preserves the long-input Command-T fallback without a large argument spread", () => {
    const m = new Matcher([0], ["ż".repeat(20000) + "b"], { ignoreDiacritics: true });
    expect(
      m.match("zz", { algorithm: "command-t", recordMatchIndexes: true })[0].matchIndexes,
    ).toEqual([19998, 19999]);
  });
});
