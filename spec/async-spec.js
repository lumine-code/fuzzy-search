const { Matcher } = require("../lib/main");

describe("Cooperative ranking", () => {
  const values = Array.from({ length: 8193 }, (_, i) => `src/Żółć-${i % 71}/sample-${i}.js`);
  const create = () =>
    new Matcher(
      values.map((_, i) => i),
      values,
      { ignoreDiacritics: true },
    );
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
    setTimeout(() => abort.abort(reason), 0);
    await expectAsync(matcher.matchIdsAsync("s", {}, { signal: abort.signal })).toBeRejectedWith(
      reason,
    );
    expect(matcher.job).toBeNull();
    expect(await matcher.matchIdsAsync("sa")).toEqual(create().matchIds("sa"));
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
