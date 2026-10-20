const { Matcher } = require("../lib/main");

describe("Cooperative ranking", () => {
  const values = Array.from({ length: 8193 }, (_, i) => `src/Żółć-${i % 71}/sample-${i}.js`);
  const create = () =>
    new Matcher(
      values.map((_, i) => i),
      values,
      { ignoreDiacritics: true },
    );
  it("prepares scores for a worker round trip without sorting or rescoring them", async () => {
    const matcher = create();
    const job = await matcher.scanAsync("sample", { algorithm: "fuzzaldrin" });
    expect(job.order).toBeNull();
    expect(job.raw.length).toBe(values.length);
    spyOn(job.fz, "scoreEligible").and.callThrough();
    const options = {
      algorithm: "fuzzaldrin",
      scoreModifier: (score, id) => score * (1 + (id % 7)),
    };
    expect(await matcher.matchIdsAsync("sample", options)).toEqual(
      create().matchIds("sample", options),
    );
    expect(job.fz.scoreEligible).not.toHaveBeenCalled();
  });
  for (const algorithm of ["command-t", "fuzzaldrin"]) {
    it(`retains every result and the exact full ordering for ${algorithm}`, async () => {
      const sync = create();
      const async = create();
      for (const query of ["s", "sa", "sam", "s", "zolc", "notfound", ""]) {
        const options = {
          algorithm,
          rootPath: "src/Żółć-4",
          scoreModifier: (score, id) => (id % 13 === 0 ? 0 : score * (1 + (id % 5))),
        };
        expect(await async.matchIdsAsync(query, options)).toEqual(sync.matchIds(query, options));
      }
      expect(await async.matchIdsAsync("s", { algorithm, maxResults: 23 })).toEqual(
        sync.matchIds("s", { algorithm, maxResults: 23 }),
      );
      expect(await async.matchIdsAsync("s", { algorithm })).toEqual(
        sync.matchIds("s", { algorithm }),
      );
    });
  }
  it("lets queued input run before completion and cancels without caching a partial scan", async () => {
    const matcher = create();
    const abort = new AbortController();
    const reason = new Error("new input");
    // Queue input on the same host task queue. Node does not guarantee whether
    // a zero-delay timer or setImmediate runs first across platforms.
    setImmediate(() => abort.abort(reason));
    await expectAsync(matcher.matchIdsAsync("s", {}, { signal: abort.signal })).toBeRejectedWith(
      reason,
    );
    expect(matcher.job).toBeNull();
    expect(await matcher.matchIdsAsync("sa")).toEqual(create().matchIds("sa"));
  });
  it("discards work cancelled after scoring has already started", async () => {
    const matcher = create();
    const abort = new AbortController();
    const reason = new Error("cancel partial work");
    let calls = 0;
    await expectAsync(
      matcher.matchIdsAsync(
        "s",
        {
          scoreModifier(score) {
            if (++calls === 257) abort.abort(reason);
            return score;
          },
        },
        { signal: abort.signal },
      ),
    ).toBeRejectedWith(reason);
    expect(calls).toBeGreaterThanOrEqual(257);
    expect(calls).toBeLessThan(values.length);
    expect(matcher.job).toBeNull();
    expect(await matcher.matchIdsAsync("s")).toEqual(create().matchIds("s"));
  });
  it("rejects a changed candidate generation and leaves the replacement intact", async () => {
    const matcher = create();
    const pending = matcher.matchIdsAsync("s");
    matcher.setCandidates([0], ["replacement"]);
    await expectAsync(pending).toBeRejectedWithError(
      "Candidates changed during asynchronous matching",
    );
    expect(matcher.matchIds("replacement")).toEqual([0]);
  });
  it("does not expose an incomplete cache when a score callback throws", async () => {
    const matcher = create();
    await expectAsync(
      matcher.matchIdsAsync("s", {
        scoreModifier() {
          throw new Error("modifier failed");
        },
      }),
    ).toBeRejectedWithError("modifier failed");
    expect(await matcher.matchIdsAsync("s")).toEqual(create().matchIds("s"));
  });
});
