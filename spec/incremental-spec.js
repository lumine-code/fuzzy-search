const { Matcher } = require("../lib/main");
const { prepare } = require("../lib/text");
const fuzzaldrin = require("../lib/fuzzaldrin");

const matcher = (values, options) =>
  new Matcher(
    values.map((_, i) => i),
    values,
    options,
  );
const fresh = (values, query, options, constructor) =>
  matcher(values, constructor).match(query, options);
const prepareQuery = (value) => {
  const text = prepare(value);
  text.codes = Uint32Array.from(text.codes, (c) => c.charCodeAt(0));
  text.folded = Uint32Array.from(text.folded, (c) => c.charCodeAt(0));
  return text;
};

describe("Incremental Fuzzaldrin eligibility", () => {
  it("bounds retained state when score modifiers throw", () => {
    const m = matcher(Array.from({ length: 100000 }, (_, i) => `a${i}`));
    for (const query of ["a", "a-", "a_", "a:", "a/", "a\\", "a--", "a__", "a//"]) {
      expect(() =>
        m.match(query, {
          algorithm: "fuzzaldrin",
          scoreModifier() {
            throw new Error("modifier");
          },
        }),
      ).toThrowError("modifier");
      const bytes = [...m.jobs.values()].reduce(
        (sum, job) =>
          sum +
          (job.raw?.byteLength || 0) +
          (job.endpoints?.byteLength || 0) +
          (job.eligible?.byteLength || 0) +
          (job.order?.byteLength || 0),
        0,
      );
      expect(bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    }
    expect(m.matchIds("a", { algorithm: "fuzzaldrin", maxResults: 1 })).toEqual([0]);
  });
  it("extends the earliest feasible subsequence, never the preferred alignment", () => {
    const text = prepare("xaxb/ab");
    const before = fuzzaldrin(prepareQuery("ab"), {});
    const after = fuzzaldrin(prepareQuery("aba"), {});
    // Preferred basename alignment ends at the end of the string, but an
    // earlier, lower-scoring prefix can still consume the appended a.
    expect(before.endIndex(text)).toBe(4);
    expect(after.endIndex(text, 2, 4)).toBe(6);
    const m = matcher(["xaxb/ab"]);
    m.match("ab", { algorithm: "fuzzaldrin" });
    expect(m.matchIds("aba", { algorithm: "fuzzaldrin" })).toEqual([0]);
  });
  it("does not use eligibility bounds to clip Fuzzaldrin's scoring matrix", () => {
    // Fuzzaldrin permits partial alignments in scoring after its independent
    // full-subsequence eligibility guard. Its early c can contribute to bc's
    // score even though the earliest complete bc subsequence ends at index 4.
    const values = ["cbxc"];
    const m = matcher(values),
      options = { algorithm: "fuzzaldrin", recordMatchIndexes: true };
    m.match("b", options);
    expect(m.match("bc", options)).toEqual(fresh(values, "bc", options));
  });

  it("keeps ASCII kernels identical to the generic scalar recurrence around precision limits", () => {
    for (const length of [2, 3, 4, 16, 31, 32, 33, 64, 128]) {
      const query = "abc".repeat(Math.ceil(length / 3)).slice(0, length);
      const value =
        "z" +
        Array.from(query, (c, i) => c + (i % 2 ? "xy" : "wx")).join("") +
        "/x" +
        Array.from(query, (c, i) => c + (i % 3 ? "-" : "pq")).join("");
      const ascii = prepare(value);
      const generic = {
        ...ascii,
        codes: Uint32Array.from(ascii.codes, (c) => c.charCodeAt(0)),
        folded: Uint32Array.from(ascii.folded, (c) => c.charCodeAt(0)),
      };
      for (const usePathScoring of [false, true]) {
        const fast = fuzzaldrin(prepareQuery(query), { usePathScoring });
        const reference = fuzzaldrin(prepareQuery(query), { usePathScoring });
        expect(fast.score(ascii))
          .withContext(`${length}/${usePathScoring}`)
          .toBe(reference.score(generic));
        expect(fast.indexes(ascii)).toEqual(reference.indexes(generic));
      }
    }
  });

  it("agrees with exhaustive subsequence enumeration for small strings", () => {
    const alphabet = ["a", "b", "_"];
    const strings = [""];
    let level = [""];
    for (let length = 1; length <= 5; length++) {
      level = level.flatMap((s) => alphabet.map((c) => s + c));
      strings.push(...level);
    }
    const end = (text, core) => {
      if (!text.length) return -1;
      let best = Infinity;
      function visit(q, start) {
        if (q === core.length) {
          best = Math.min(best, start);
          return;
        }
        for (let i = start; i < text.length; i++) if (text[i] === core[q]) visit(q + 1, i + 1);
      }
      visit(0, 0);
      return best === Infinity ? -1 : best;
    };
    for (const query of ["", "a", "b", "ab", "a-b", "_a_", "a_a", "b-a-b"]) {
      const old = fuzzaldrin(prepareQuery(query), {});
      for (const suffix of ["a", "b", "_", "/a"]) {
        const next = fuzzaldrin(prepareQuery(query + suffix), {});
        const required = Array.from(next.core, (c) => String.fromCodePoint(c));
        for (const value of strings) {
          const text = prepare(value);
          const prior = old.endIndex(text);
          const incremental = prior < 0 ? -1 : next.endIndex(text, old.core.length, prior);
          expect(incremental).withContext(`${value}/${query}+${suffix}`).toBe(end(value, required));
        }
      }
    }
  });

  it("preserves full scores, ordering and highlights through edits and mutations", () => {
    let values = ["xaxb/ab", "a_b", "abAB", "Straße🙂", "Żółć", "Kb", "ſb", "src/a-b.js", ""];
    for (const ignoreDiacritics of [false, true]) {
      const constructor = { ignoreDiacritics };
      const m = matcher(values, constructor);
      for (const query of [
        "-",
        "-a",
        "-ab",
        "-a/b",
        "ab",
        "aba",
        "",
        "s",
        "st",
        "strasse",
        "strasse🙂",
        "ſ",
        "ſb",
        "k",
        "Kb",
        "ż",
        "żó",
      ]) {
        const options = { algorithm: "fuzzaldrin", recordMatchIndexes: true, maxResults: 3 };
        expect(m.match(query, options))
          .withContext(query)
          .toEqual(fresh(values, query, options, constructor));
      }
      m.match("abc", { algorithm: "fuzzaldrin" });
      m.addCandidates([values.length], ["abcd"]);
      expect(m.matchIds("abcd", { algorithm: "fuzzaldrin" })).toEqual([values.length]);
      m.removeCandidates([values.length]);
      expect(m.matchIds("abcd", { algorithm: "fuzzaldrin" })).toEqual([]);
      values = [...values];
    }
  });
});
