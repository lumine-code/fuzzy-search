const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { Pool } = require("./worker-pool");
const implementation = path.resolve(process.argv[2]),
  corpus = JSON.parse(fs.readFileSync(process.argv[3]));
const { Matcher } = require(implementation);
const count = Number(process.argv[4] || 100000),
  out = process.argv[5];
const values = Array.from({ length: count }, (_, i) =>
  i < corpus.length
    ? corpus[i]
    : `project-${Math.floor(i / corpus.length)}/${corpus[i % corpus.length]}`,
);
const ids = values.map((_, i) => i),
  results = [];
const queries = [
  ["se", "sel"],
  ["s", "src"],
  ["ma", "main"],
];
const expectations = new Map(
  queries.map(([, q]) => [q, new Matcher(ids, values).matchIds(q, { algorithm: "fuzzaldrin" })]),
);
const summary = (times) => {
  const sorted = times.slice().sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], samples: times };
};
(async () => {
  for (const workers of [1, 2, 4, 8]) {
    const samples = queries.map(() => []),
      builds = [],
      first = [];
    for (let sample = -2; sample < 7; sample++) {
      const start = performance.now(),
        pool = new Pool(implementation, values, workers);
      try {
        await pool.ready;
        const ready = performance.now() - start;
        for (let i = 0; i < queries.length; i++) {
          const [prefix, query] = queries[i];
          await pool.matchIds(prefix);
          const before = performance.now(),
            result = await pool.matchIds(query),
            completed = performance.now(),
            elapsed = completed - before;
          assert.deepEqual(result, expectations.get(query), `workers=${workers}, query=${query}`);
          if (sample >= 0) samples[i].push(elapsed);
          if (i === 0 && sample >= 0) first.push(completed - start);
        }
        if (sample >= 0) builds.push(ready);
      } finally {
        await pool.close();
      }
    }
    const row = {
      workers,
      count,
      prepare: summary(builds),
      prepareAndFirstExtension: summary(first),
      queries: queries.map(([before, after], i) => ({ before, after, ...summary(samples[i]) })),
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }
  fs.writeFileSync(out, JSON.stringify({ runtime: process.versions, results }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
