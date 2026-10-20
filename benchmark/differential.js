// The native reference is supplied explicitly; it is never a runtime dependency.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Matcher } = require("../lib/main");
const Native = require(require("node:path").resolve(process.argv[2])).Matcher;
const corpus = JSON.parse(fs.readFileSync(process.argv[3]));
let seed = 0x1a2b3c4d;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
};
const alphabet = Array.from("abAB_-/\\ .012éÉŻżΣσςKkßẞ🙂𐐀𐐨");
const values = corpus.slice(0, 1500);
for (let i = 0; i < 2000; i++) {
  let s = "";
  for (let j = 0, len = 1 + (random() % 35); j < len; j++)
    s += alphabet[random() % alphabet.length];
  values.push(s);
}
const queries = [
  "a",
  "ab",
  "s",
  "src",
  "slv",
  "main",
  "abc",
  "A",
  "é",
  "σ",
  "K",
  "ß",
  "🙂",
  "𐐨",
  "_",
  "/",
  "a-b",
  "foo/bar",
  "a a",
  "notfound",
];
for (let i = 0; i < 80; i++) {
  const chars = Array.from(values[random() % values.length]);
  queries.push(chars.filter(() => random() % 3 === 0).join(""));
}
let comparisons = 0,
  scoreDifferences = 0,
  indexDifferences = 0;
const examples = [];
for (const ignoreDiacritics of [false, true])
  for (const algorithm of ["command-t", "fuzzaldrin"])
    for (const extra of [
      {},
      { usePathScoring: false },
      { useExtensionBonus: true },
      { caseSensitive: true },
      { smartCase: true },
      { maxGap: 1 },
    ]) {
      const ids = values.map((_, i) => i);
      const native = new Native(ids, values, { ignoreDiacritics });
      const js = new Matcher(ids, values, { ignoreDiacritics });
      for (const q of queries) {
        const options = { algorithm, recordMatchIndexes: true, ...extra };
        const expected = native.match(q, options),
          actual = js.match(q, options);
        const byId = new Map(actual.map((r) => [r.id, r]));
        assert.deepEqual(
          [...byId.keys()].sort((a, b) => a - b),
          expected.map((r) => r.id).sort((a, b) => a - b),
          JSON.stringify({ q, ignoreDiacritics, options }),
        );
        for (const e of expected) {
          const a = byId.get(e.id);
          comparisons++;
          if (Math.abs(e.score - a.score) > Math.max(1e-6, e.score * 1e-5)) {
            scoreDifferences++;
            if (examples.filter((e) => e.type === "score").length < 10)
              examples.push({
                type: "score",
                q,
                value: e.value,
                options,
                native: e.score,
                js: a.score,
              });
          }
          if (JSON.stringify(e.matchIndexes) !== JSON.stringify(a.matchIndexes)) {
            indexDifferences++;
            if (examples.filter((e) => e.type === "indexes").length < 10)
              examples.push({
                type: "indexes",
                q,
                value: e.value,
                options,
                native: e.matchIndexes,
                js: a.matchIndexes,
              });
          }
        }
      }
    }
console.log(JSON.stringify({ comparisons, scoreDifferences, indexDifferences, examples }, null, 2));
assert.equal(scoreDifferences, 0);
assert.equal(indexDifferences, 0);
