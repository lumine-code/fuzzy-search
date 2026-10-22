const { Matcher } = require("../lib/main");

describe("Long Command-T inputs", () => {
  it("agrees with fresh matching when refinement crosses the long-input boundary", async () => {
    const values = ["a".repeat(500)];
    const options = { smartCase: true, recordMatchIndexes: true };
    const matcher = new Matcher([0], values);
    matcher.match("A".repeat(19), options);
    expect(matcher.match("A".repeat(20), options)).toEqual(
      new Matcher([0], values).match("A".repeat(20), options),
    );
    const asynchronous = new Matcher([0], values);
    await asynchronous.matchIdsAsync("A".repeat(19), options);
    expect(await asynchronous.matchIdsAsync("A".repeat(20), options)).toEqual(
      new Matcher([0], values).matchIds("A".repeat(20), options),
    );
  });

  it("rescans a rejected long input when refinement moves the approximate alignment", async () => {
    const value = "A".repeat(20) + "b" + "a".repeat(500);
    const matcher = new Matcher([0], [value]);
    const options = { smartCase: true };
    expect(matcher.matchIds("A".repeat(20), options)).toEqual([]);
    const query = "A".repeat(20) + "b";
    expect(matcher.matchIds(query, options)).toEqual([0]);
    expect(await matcher.matchIdsAsync(query, options)).toEqual(
      new Matcher([0], [value]).matchIds(query, options),
    );
  });

  it("agrees with exhaustive bounded-gap eligibility on seeded long candidates", () => {
    let seed = 187;
    const random = (limit) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % limit;
    const alphabet = "ab/_\\";
    const equal = (query, value) =>
      query === value ||
      ((query === "_" || query === "/" || query === "\\") && (value === "/" || value === "\\"));
    for (let sample = 0; sample < 256; sample++) {
      const text = Array.from(
        { length: 4 + random(9) },
        () => alphabet[random(alphabet.length)],
      ).join("");
      const query = Array.from(
        { length: 2 + random(4) },
        () => alphabet[random(alphabet.length)],
      ).join("");
      const maxGap = 1 + random(3);
      function eligible(q, start) {
        if (q === query.length) return true;
        const end = q ? Math.min(text.length, start + maxGap + 1) : text.length;
        for (let i = start; i < end; i++)
          if (equal(query[q], text[i]) && eligible(q + 1, i + 1)) return true;
        return false;
      }
      const matcher = new Matcher([0], [text + "x".repeat(5000)]);
      const result = matcher.match(query, { maxGap, recordMatchIndexes: true });
      expect(result.length > 0)
        .withContext(`${text}/${query}/${maxGap}`)
        .toBe(eligible(0, 0));
      if (result.length) {
        const positions = result[0].matchIndexes;
        expect(positions.length).toBe(query.length);
        positions.forEach((position, i) => {
          expect(equal(query[i], text[position])).toBe(true);
          if (i) expect(position - positions[i - 1]).toBeLessThanOrEqual(maxGap + 1);
        });
      }
    }
  });

  it("honors maxGap on long inputs and finds a feasible earlier alignment", () => {
    const bad = "a" + "x".repeat(10000) + "b";
    const good = "ab" + "x".repeat(10000) + "b";
    const matcher = new Matcher([0, 1], [bad, good]);
    const result = matcher.match("ab", { maxGap: 1, recordMatchIndexes: true });
    expect(result.map((item) => item.id)).toEqual([1]);
    expect(result[0].matchIndexes).toEqual([0, 1]);
  });

  it("retains smart-case penalties on long inputs", () => {
    const matcher = new Matcher([0, 1], ["a".repeat(500), "A".repeat(500)]);
    const result = matcher.match("A".repeat(20), { smartCase: true });
    expect(result.map((item) => item.id)).toEqual([1]);
  });

  it("returns highlights for a long exact query without argument-stack overflow", () => {
    const text = "a".repeat(150000);
    const result = new Matcher([0], [text]).match(text, { recordMatchIndexes: true });
    expect(result[0].score).toBe(1);
    expect(result[0].matchIndexes.length).toBe(text.length);
    expect(result[0].matchIndexes.at(-1)).toBe(text.length - 1);
  });
});

describe("Seeded matcher state transitions", () => {
  it("matches fresh instances through edits, cache pressure, mutations and concurrent requests", async () => {
    let seed = 0x20261022;
    const random = (limit) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % limit;
    const alphabet = Array.from("abAB_-/\\ éŻßΣσς🙂𐐀\t");
    const word = (length) =>
      Array.from({ length }, () => alphabet[random(alphabet.length)]).join("");
    for (const ignoreDiacritics of [false, true])
      for (const algorithm of ["command-t", "fuzzaldrin"]) {
        let values = Array.from({ length: 120 }, () => word(3 + random(25)));
        let ids = values.map((_, i) => i * 17);
        const matcher = new Matcher(ids, values, { ignoreDiacritics });
        const fresh = () => new Matcher(ids, values, { ignoreDiacritics });
        for (let iteration = 0; iteration < 60; iteration++) {
          if (iteration % 10 === 0) {
            values = values.slice(1).concat(word(12));
            ids = ids.slice(1).concat(10000 + iteration);
            matcher.setCandidates(ids, values);
          }
          const value = Array.from(values[random(values.length)]);
          const query = value.filter(() => random(3) === 0).join("");
          const options = {
            algorithm,
            smartCase: !!random(2),
            caseSensitive: !!random(2),
            maxGap: random(4),
            usePathScoring: !!random(2),
            useExtensionBonus: !!random(2),
            maxResults: random(12),
            rootPath: "a/b",
            recordMatchIndexes: true,
            ...(iteration % 3
              ? {}
              : { scoreModifier: (score, id) => (id % 5 === 0 ? 0 : score * (1 + (id % 7))) }),
          };
          matcher.match(query.slice(0, -1), options);
          matcher.getMatchIndexes(ids[0], word(3), options);
          matcher.matchCandidate(word(8), word(2), options);
          expect(matcher.match(query, options))
            .withContext(`${algorithm}/${ignoreDiacritics}/${iteration}`)
            .toEqual(fresh().match(query, options));
          const queries = [query, word(2), query + "a"];
          const results = await Promise.all(queries.map((q) => matcher.matchIdsAsync(q, options)));
          results.forEach((result, i) =>
            expect(result).toEqual(fresh().matchIds(queries[i], options)),
          );
        }
      }
  });
});
