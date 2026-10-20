// Focused first-extension measurements; never time a previously cached query.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const args = process.argv.slice(2);
const option = (key, fallback) =>
  args.includes("--" + key) ? args[args.indexOf("--" + key) + 1] : fallback;
const implementation = path.resolve(option("module", ".."));
const { Matcher } = require(implementation);
const input = fs.readFileSync(option("corpus"));
const source = JSON.parse(input);
const samples = Number(option("samples", 9)),
  warmups = Number(option("warmups", 3));
const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
const sourceHash = () =>
  fs.statSync(implementation).isDirectory()
    ? hash(
        JSON.stringify(
          fs
            .readdirSync(path.join(implementation, "lib"))
            .sort()
            .filter((f) => f.endsWith(".js") || f.endsWith(".json"))
            .map((f) => [f, hash(fs.readFileSync(path.join(implementation, "lib", f)))]),
        ),
      )
    : hash(fs.readFileSync(implementation));
const beforeHash = sourceHash();
const results = [];
for (const count of option("sizes", "10000,100000").split(",").map(Number)) {
  const values = Array.from({ length: count }, (_, i) =>
    i < source.length
      ? source[i]
      : `project-${Math.floor(i / source.length)}/${source[i % source.length]}`,
  );
  const ids = values.map((_, i) => i);
  for (const [before, after] of [
    ["", "s"],
    ["se", "sel"],
    ["s", "src"],
    ["ma", "main"],
    ["zz", "zzq"],
  ]) {
    const times = [];
    let resultCount, digest;
    for (let sample = -warmups; sample < samples; sample++) {
      const m = new Matcher(ids, values);
      const options = { algorithm: "fuzzaldrin", numThreads: 8 };
      if (before) m.match(before, options);
      global.gc?.();
      const start = performance.now();
      const result = m.match(after, options);
      const elapsed = performance.now() - start;
      resultCount = result.length;
      digest = hash(JSON.stringify(result.map((r) => [r.id, r.score])));
      if (sample >= 0) times.push(elapsed);
    }
    const sorted = times.slice().sort((a, b) => a - b);
    const row = {
      count,
      before,
      after,
      resultCount,
      digest,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      samples: times,
    };
    results.push(row);
    console.log(JSON.stringify({ count, before, after, ms: row.median, resultCount }));
  }
}
if (beforeHash !== sourceHash()) throw new Error("Implementation changed during measurement");
fs.writeFileSync(
  option("output"),
  JSON.stringify(
    {
      runtime: process.versions,
      sourceHash: beforeHash,
      corpusHash: hash(input),
      driverHash: hash(fs.readFileSync(__filename)),
      samples,
      warmups,
      gcAfterSetup: !!global.gc,
      results,
    },
    null,
    2,
  ),
);
