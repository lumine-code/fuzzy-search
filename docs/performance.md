# Performance and adoption

This library is a completed JavaScript port of fuzzy-native, not a universally faster replacement. Lumine currently retains the native implementation because uncached Fuzzaldrin query extensions still regress in the measured renderer workloads. Query reuse, prepared highlighting and simpler deployment remain useful properties, but they do not establish parity for every request.

The [editor evaluation](https://github.com/lumine-code/lumine/blob/master/docs/fuzzy-matching-evaluation-2026-10-20.md) records the adoption decision, integration improvements, consumer review and performance measurements. Both native algorithms remain available here; an experimental alternative alignment policy did not satisfy the performance condition and was removed.

Run the existing specs with `npm test`. `benchmark/differential.js <native.node> <corpus.json>` compares both algorithms over a seeded mixed ASCII/Unicode corpus, including case modes, optional separators, expansion offsets and ordered score groups. The native binary is supplied explicitly and is never a runtime dependency.

For timing, run `node benchmark/run.js --module <implementation> --corpus <corpus.json> --output <report.json>` in fresh alternating processes. For memory, run `node --expose-gc benchmark/memory.js <implementation> <corpus.json> 100000`. A corpus is a JSON array of paths; larger requested sizes repeat it under numbered project roots. Use CPU profiling separately from timing runs. Reports include runtime metadata and retain raw samples rather than only an aggregate speed ratio.
