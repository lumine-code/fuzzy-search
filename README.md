# fuzzy-search

Ranks fuzzy matches with path scoring and Unicode-aware highlighting.

Fork of [lumine-code/fuzzy-native](https://github.com/lumine-code/fuzzy-native), ported to JavaScript while preserving its Command-T and fuzzaldrin scoring contracts.

The [performance evaluation](docs/performance.md) records the native comparison and the subsequent refinement optimizations.

## Features

- **Ranking**: supports Command-T and fuzzaldrin with path and extension bonuses.
- **Unicode**: uses pinned Unicode 17 simple case folding and original UTF-16 highlight offsets.
- **Prepared candidates**: reuses normalization and structural metadata across queries.
- **Query reuse**: caches scores and ordering for recent queries and narrows compatible refinements.
- **Result selection**: uses a bounded heap for top-N requests and supports final score modifiers.
- **Integration**: exposes ID-only ranking and highlights for existing candidates without reconstructing matchers.

## Usage

```js
const { Matcher } = require("@lumine-code/fuzzy-search");
const matcher = new Matcher([0, 1], ["src/main.js", "Straße"], {
  ignoreDiacritics: true,
});
const results = matcher.match("strasse", {
  algorithm: "fuzzaldrin",
  recordMatchIndexes: true,
});
```

`match`, `setCandidates`, `addCandidates` and `removeCandidates` retain the native library's API. `matchIds(query, options)` returns only the ranked IDs. `getMatchIndexes(id, query, options)` highlights an already prepared candidate, returning `null` for a missing candidate or non-match. `scoreModifier(score, id)` adjusts normalized scores before selection and sorting; it runs again on every request because application state can change independently of the query. It must not mutate or reenter the matcher.

Matching is synchronous and runs on the calling JavaScript thread. The legacy `numThreads` option is accepted but does not create workers. Scores and rankings retain native single-precision arithmetic where it determines alignment. Exact score ties use candidate length and then numeric ID for deterministic ordering.

Candidate mutations invalidate query caches. Up to eight prepared queries retain at most eight MiB of score, eligibility and ordering arrays; query workspaces and candidate metadata are additional. Each query can reuse at most 2048 basename scores covering 65536 UTF-16 units. The one-text API retains at most 128 texts covering 65536 UTF-16 units. Queries longer than 256 UTF-16 units are not retained in the recent-query cache.

Candidate folding, separator normalization and path metadata are prepared once when candidates are added. A compatible query extension reuses the earliest feasible end of its required-character subsequence solely to check eligibility. It recalculates the complete Fuzzaldrin score and highlight alignment; the best-scoring previous alignment is never used as a rejection boundary.

See `lib/main.d.ts` for options and result types. Run `npm test` for correctness and `node benchmark/run.js --module <implementation> --corpus <paths.json> --output <report.json>` for isolated performance measurements. The corpus is a JSON array of file paths. Supply a native `.node` reference explicitly to `benchmark/differential.js` when comparing against the previous implementation.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
