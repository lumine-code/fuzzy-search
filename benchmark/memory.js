// Fresh process per implementation. Run with --expose-gc.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Matcher } = require(path.resolve(process.argv[2]));
const corpus = JSON.parse(fs.readFileSync(process.argv[3]));
const count = Number(process.argv[4] || 100000);
const values = Array.from({ length: count }, (_, i) =>
  i < corpus.length
    ? corpus[i]
    : `project-${Math.floor(i / corpus.length)}/${corpus[i % corpus.length]}`,
);
const ids = values.map((_, id) => id);
assert.equal(typeof global.gc, "function", "Run with --expose-gc");
global.gc();
const before = process.memoryUsage();
const matcher = new Matcher(ids, values);
global.gc();
const prepared = process.memoryUsage();
for (const query of ["s", "se", "sel", "main", "slv", "test", "lib", "notfound"])
  matcher.match(query, { algorithm: "fuzzaldrin", numThreads: 8 });
global.gc();
const queried = process.memoryUsage();
console.log(
  JSON.stringify({ runtime: process.versions, count, before, prepared, queried }, null, 2),
);
