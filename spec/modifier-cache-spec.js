const { Matcher } = require("../lib/main");

describe("Versioned score modifiers", () => {
  for (const algorithm of ["command-t", "fuzzaldrin"]) {
    it(`reuses adjusted scores until the function or version changes with ${algorithm}`, async () => {
      const matcher = new Matcher([0, 1, 2], ["main.js", "src/main.js", "test/main.js"]);
      let wanted = 2;
      const modify = jasmine
        .createSpy("modifier")
        .and.callFake((score, id) => (id === wanted ? score * 10 : 0));
      const options = { algorithm, scoreModifier: modify, scoreModifierVersion: 0 };
      const first = matcher.match("main", options);
      expect(first.map((row) => row.id)).toEqual([2]);
      expect(modify.calls.count()).toBe(3);
      expect(matcher.match("main", options)).toEqual(first);
      expect(await matcher.matchIdsAsync("main", options)).toEqual([2]);
      expect(modify.calls.count()).toBe(3);
      wanted = 1;
      expect(matcher.matchIds("main", options)).toEqual([2]);
      options.scoreModifierVersion++;
      expect(matcher.matchIds("main", options)).toEqual([1]);
      expect(modify.calls.count()).toBe(6);
      options.scoreModifier = (score, id) => (id === 0 ? score : 0);
      expect(matcher.matchIds("main", options)).toEqual([0]);
      expect(matcher.matchIds("main", { algorithm })).toEqual(
        new Matcher([0, 1, 2], ["main.js", "src/main.js", "test/main.js"]).matchIds("main", {
          algorithm,
        }),
      );
    });

    it(`keeps scores reusable across limits and roots, but not candidate edits with ${algorithm}`, () => {
      const matcher = new Matcher([0, 1, 2], ["main.js", "src/main.js", "test/main.js"]);
      const modify = jasmine.createSpy("modifier").and.callFake((score) => score);
      const options = { algorithm, scoreModifier: modify, scoreModifierVersion: "stable" };
      matcher.matchIds("main", { ...options, maxResults: 1 });
      const all = matcher.matchIds("main", options);
      expect(all.length).toBe(3);
      matcher.matchIds("main", { ...options, rootPath: "test" });
      expect(modify.calls.count()).toBe(3);
      matcher.setCandidates([0, 1], ["main.js", "other.js"]);
      expect(matcher.matchIds("main", options)).toEqual([0]);
      expect(modify.calls.count()).toBe(4);
    });

    it(`snapshots versions and never publishes cancelled adjustments with ${algorithm}`, async () => {
      const values = Array.from({ length: 1025 }, (_, i) => `main-${i}`);
      const matcher = new Matcher(
        values.map((_, i) => i),
        values,
      );
      const options = {
        algorithm,
        scoreModifier: (score, id) => (id === 0 ? score : 0),
        scoreModifierVersion: 0,
      };
      const first = matcher.matchIdsAsync("main", options);
      options.scoreModifierVersion = 1;
      options.scoreModifier = (score, id) => (id === 1 ? score : 0);
      const second = matcher.matchIdsAsync("main", options);
      expect(await first).toEqual([0]);
      expect(await second).toEqual([1]);
      const controller = new AbortController();
      const reason = new Error("cancel scores");
      const cancelled = {
        ...options,
        scoreModifierVersion: 2,
        scoreModifier: () => {
          controller.abort(reason);
          return 0;
        },
      };
      await expectAsync(
        matcher.matchIdsAsync("main", cancelled, { signal: controller.signal }),
      ).toBeRejectedWith(reason);
      expect(matcher.matchIds("main", options)).toEqual([1]);
    });
  }

  it("counts retained adjusted scores against the query-cache memory limit", () => {
    const values = Array.from({ length: 100000 }, (_, i) => `main-${i}`);
    const matcher = new Matcher(
      values.map((_, i) => i),
      values,
    );
    const options = {
      algorithm: "fuzzaldrin",
      scoreModifier: (score) => score,
      scoreModifierVersion: 0,
    };
    for (const query of ["m", "ma", "mai", "main", "main1", "main2"])
      matcher.matchIds(query, options);
    expect(matcher.cacheBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    for (const job of matcher.jobs.values()) {
      expect(job.bytes).toBe(
        (job.raw?.byteLength ?? 0) +
          (job.order?.byteLength ?? 0) +
          (job.eligible?.byteLength ?? 0) +
          (job.endpoints?.byteLength ?? 0) +
          (job.modifiedScores?.byteLength ?? 0),
      );
    }
  });
});
