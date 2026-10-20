// --module <native.node or JS directory> --corpus <paths.json> --output <report.json>
// Run implementations in separate fresh processes, alternating ABBA order.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const modulePath = path.resolve(option("module", path.join(__dirname, "..")));
const { Matcher } = require(modulePath);
const corpusBytes = fs.readFileSync(option("corpus"));
const source = JSON.parse(corpusBytes);
const output = option("output");
const samples = Number(option("samples", 9)),
  warmups = Number(option("warmups", 3));
const sizes = option("sizes", "1000,10000,100000").split(",").map(Number);
const algorithms = option("algorithms", "command-t,fuzzaldrin").split(",");
const results = [];
const summary = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samples: values,
  };
};
let sink = 0;
function measure(id, setup, run) {
  const times = [];
  let count;
  for (let i = -warmups; i < samples; i++) {
    const state = setup();
    global.gc?.();
    const start = performance.now();
    const result = run(state);
    const elapsed = performance.now() - start;
    count = typeof result === "number" ? result : result.length;
    sink += count;
    if (i >= 0) times.push(elapsed);
  }
  const row = { id, count, ...summary(times) };
  results.push(row);
  console.log(JSON.stringify({ id, median: row.median, p95: row.p95, count }));
}
for (const count of sizes) {
  // Real fleet paths; larger corpora repeat them under separate project roots.
  const values = Array.from({ length: count }, (_, i) =>
    i < source.length
      ? source[i]
      : `project-${Math.floor(i / source.length)}/${source[i % source.length]}`,
  );
  const ids = values.map((_, i) => i);
  measure(
    `build/${count}`,
    () => null,
    () => new Matcher(ids, values).match("no-such-query-987654321").length,
  );
  const threads = Math.max(1, Math.min(8, os.availableParallelism() - 1));
  for (const algorithm of algorithms) {
    for (const limit of [0, 200]) {
      const options = { algorithm, numThreads: threads, maxResults: limit };
      const matcher = new Matcher(ids, values);
      for (const query of ["s", "main", "slv", "notfound987654321"]) {
        measure(
          `${algorithm}/${count}/${limit || "all"}/cold/${query}`,
          () => new Matcher(ids, values),
          (m) => m.match(query, options),
        );
        measure(
          `${algorithm}/${count}/${limit || "all"}/repeat/${query}`,
          () => {
            matcher.match("reset-query-987654321", options);
            return matcher;
          },
          (m) => m.match(query, options),
        );
      }
      measure(
        `${algorithm}/${count}/${limit || "all"}/typing`,
        () => new Matcher(ids, values),
        (m) => {
          let total = 0;
          for (const q of ["s", "se", "sel", "sele", "sel", "se", "s"])
            total += m.match(q, options).length;
          return total;
        },
      );
    }
  }
}
const small = source.slice(0, 100);
for (const algorithm of algorithms) {
  const matcher = new Matcher([0], [small[0]]);
  measure(
    `${algorithm}/single-highlights/100`,
    () => null,
    () => {
      let total = 0;
      for (const text of small) {
        matcher.setCandidates([0], [text]);
        total += matcher.match("s", { algorithm, recordMatchIndexes: true }).length;
      }
      return total;
    },
  );
  measure(
    `${algorithm}/prepared-single-highlights/100`,
    () => new Matcher([], []),
    (m) => {
      let count = 0;
      for (const text of small) {
        const options = { algorithm, recordMatchIndexes: true };
        if (m.matchCandidate) count += !!m.matchCandidate(text, "s", options);
        else {
          m.setCandidates([0], [text]);
          count += m.match("s", options).length;
        }
      }
      return count;
    },
  );
}
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const implementationFiles = fs.statSync(modulePath).isDirectory()
  ? fs
      .readdirSync(path.join(modulePath, "lib"))
      .sort()
      .map((name) => [name, hash(fs.readFileSync(path.join(modulePath, "lib", name)))])
  : [[path.basename(modulePath), hash(fs.readFileSync(modulePath))]];
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      runtime: process.versions,
      cpu: os.cpus()[0].model,
      parallelism: os.availableParallelism(),
      modulePath,
      implementationHash: hash(JSON.stringify(implementationFiles)),
      implementationFiles,
      corpusHash: hash(corpusBytes),
      corpusSize: source.length,
      driverHash: hash(fs.readFileSync(__filename)),
      warmups,
      samples,
      gcAfterSetup: Boolean(global.gc),
      sink,
      results,
    },
    null,
    2,
  ),
);
