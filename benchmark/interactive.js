// Real picker paths remain local; reports contain hashes, timings and result digests.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const args = process.argv.slice(2);
const option = (key, fallback) =>
  args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback;
const directory = path.resolve(option("module", path.join(__dirname, "..")));
const { Matcher } = require(directory);
const bytes = fs.readFileSync(option("corpus"));
const values = JSON.parse(bytes);
const ids = values.map((_, i) => i);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sourceHash = () =>
  hash(
    JSON.stringify(
      fs
        .readdirSync(path.join(directory, "lib"))
        .filter((name) => /\.(js|json)$/.test(name))
        .sort()
        .map((name) => [name, hash(fs.readFileSync(path.join(directory, "lib", name)))]),
    ),
  );
const beforeHash = sourceHash();
const samples = Number(option("samples", 9)),
  warmups = Number(option("warmups", 2));
const results = [];
for (const [before, query] of [
  [null, null],
  [null, "s"],
  ["s", "se"],
  ["se", "sel"],
  [null, "a"],
  ["a", "ab"],
  [null, "m"],
  ["m", "ma"],
]) {
  const times = [];
  let digest, count;
  for (let sample = -warmups; sample < samples; sample++) {
    let matcher;
    const options = { algorithm: option("algorithm", "command-t") };
    if (query !== null) {
      matcher = new Matcher(ids, values, { ignoreDiacritics: true });
      if (before) matcher.matchIds(before, options);
    }
    global.gc?.();
    const start = performance.now();
    const result =
      query === null
        ? new Matcher(ids, values, { ignoreDiacritics: true }).candidates.length
        : matcher.matchIds(query, options);
    const elapsed = performance.now() - start;
    count = query === null ? result : result.length;
    digest = hash(JSON.stringify(result));
    if (sample >= 0) times.push(elapsed);
  }
  const sorted = times.slice().sort((a, b) => a - b);
  const row = {
    before,
    query,
    count,
    digest,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samples: times,
  };
  results.push(row);
  console.log(JSON.stringify({ before, query, count, median: row.median }));
}
if (beforeHash !== sourceHash()) throw new Error("Source changed during measurement");
fs.writeFileSync(
  option("output"),
  JSON.stringify(
    {
      runtime: process.versions,
      count: values.length,
      corpusHash: hash(bytes),
      sourceHash: beforeHash,
      driverHash: hash(fs.readFileSync(__filename)),
      samples,
      warmups,
      results,
    },
    null,
    2,
  ),
);
