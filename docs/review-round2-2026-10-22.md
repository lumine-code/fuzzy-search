# Query state review, second pass

This pass concentrates on ownership of cached scoring options, observer-driven query changes, and recovery after filtering failures. It supplements the [first correctness review](review-2026-10-22.md).

## Mutable scoring options

Fuzzaldrin's prepared scorer retained the caller's options object. After a highlight-only request prepared a query, mutating that old object's `usePathScoring` or `useExtensionBonus` changed the scorer without changing its cache key. A later request with a separate, correct options object could therefore return wrong scores and ordering. For example, the cached `ma` query could rank `src/main.js` above `main.js` when a fresh matcher using the requested path scoring ranked them in the reverse order.

The scorer now captures both flags as primitive values when it is created. Subsequent requests still select their own configuration and evaluate their own score modifier. Regression tests cover all four flag combinations, preparation through highlights, bulk scoring, asynchronous ID matching and the single-candidate API.

## Reentrant SelectList observers

An `onDidChangeQuery` or `onDidChangeSelection` callback may synchronously update the list again. Previously, the outer update could then start another worker request using its obsolete selection instruction but the newer query. An initial selection of `alpha` could be applied to results for `beta`, producing `No filtered item has ID alpha` instead of honouring the newer request.

The outer update now retains the source records, generation and query for which its worker selection was computed. It starts work only if that state is still current and no observer has already started replacement work. Work is registered before selection-change notifications, so a callback can cancel it normally. Regression tests cover query redirection, source replacement, clearing the query and switching to synchronous search with a different selected item.

## Error recovery

After a ranking callback failed, `refresh()` could successfully compute results while leaving the old error message visible. The list now tracks the status object owned by that filtering failure and clears it after successful asynchronous or synchronous recovery. A replacement message supplied by the package is preserved. Regression tests include retrying through refresh, switching to `worker: false`, and preserving a sticky package warning.

The focused tests failed on the previous implementation and pass with the fixes. The library suite passes 155 specs, with CI passing on Node 24 on Windows, macOS and Linux. The final integration run passes 525 specs spanning SelectList, both file finders and the command palette, after installing library commit `a2f4b3f55d8b29cbcd828caeaac33ee43607a563` in the editor. The integration regression checks both the installed library and the editor wrapper: the wrapper already copied options and masked this bug, while the installed library failed on the previous pin and passes on the new one. Audits of the library and editor report zero vulnerabilities. The changes do not introduce a backend or change result limits. Concurrent dependency updates are separate from these correctness fixes.

## Follow-up: asynchronous option ownership, 2026-10-23

The asynchronous entry points yielded before reading the caller's options. Reusing that object for a subsequent query could change an already-started request's algorithm, scoring flags, limit or score modifier. A pending query over `alpha` and `beta`, started with a modifier returning one, incorrectly returned an empty result if the caller changed the modifier to return zero before the first host task resumed.

Both `matchIdsAsync` and the internal worker score scan now capture their supported ranking options before yielding. Named property reads preserve inherited options as well as own properties; invalid inputs still reach the existing validation. Capturing the callback reference does not freeze state closed over by that callback. The synchronous path and scoring algorithms are unchanged.

Four new regressions failed before the fix: concurrent requests sharing an options object for each algorithm, inherited options changed while a request is pending, and flags changed during an asynchronous score scan. A fifth test preserves invalid-options rejection. With the fix, all 160 library specs pass locally. The earlier cross-platform CI and 525-spec integration result above apply to the preceding library revision; publication and subsequent integrated validation of this follow-up are coordinated with the fleet dependency update.

## Follow-up: source rollback and relative paths, 2026-10-23

The synchronous SelectList matcher identified its prepared source by a proposed model generation and the first record. After an update failed selection validation, the next attempt could reuse both while changing later rows. Searching for `g` then returned `delta` because the cached text was still `gamma`; searching for `delta` missed the actual item. A rejected search-configuration update could produce the same problem even without replacing source records. Cache reuse now also requires the identity of the complete record array and the captured search options. Two regression tests failed before the fix and pass afterward, including restored highlight offsets. Unchanged source and search snapshots still reuse prepared text.

The file finder's metadata worker used offsets from a lowercased path to slice the original path. A project directory containing `İ` exposed the mismatch: lowercase conversion expands it to `i` plus a combining dot, so `alpha.js` became `lpha.js` and the generated absolute path was wrong. Paths whose case conversion changes length now locate the suffix by directory boundaries; ordinary paths keep the direct substring path. Tests cover both an original `İ` root and an already-expanded candidate spelling under the same case-insensitive matching policy.

A backend-equivalence test exercises 24 state transitions over 2173 candidates, mixing source replacement, algorithms, diacritic settings, score modifiers, custom sorting, recent IDs, empty queries and superseded worker requests. It checks complete result order, selection and highlights inside and beyond the first displayed page. The full local integration run passes 530 specs in 80.385 seconds, covering SelectList, fuzzy-files, fuzzy-explorer and the command palette. Targeted core lint and the finder lint pass. This run uses the editor's installed `a2f4b3f` library with the new core and finder sources; it does not establish publication or cross-platform CI for these latest fixes, or integration of the separate asynchronous-option follow-up above.

## Follow-up: long highlights and asynchronous publication, 2026-10-23

Fuzzaldrin switches to a bounded-memory highlight trace when the candidate/query product exceeds 4194304 code points. That fallback incorrectly required optional punctuation: a query consisting of `-` followed by 100 letters matched a 43000-letter candidate but returned no letter highlights. An optional separator occurring after the required letters could similarly consume their only valid alignment. The fallback now traces the required subsequence, retaining punctuation tracing for punctuation-only queries. Scoring and result ordering are unchanged. Regression coverage checks bulk results, cached highlighting, single-candidate matching and the actual Chromium worker transport.

SelectList also retained a local filtering error after a query source took over successfully. The direct `setSource()` path now clears only the status owned by the superseded filter, using the same ownership rule as other recovery paths.

The explorer's list publication discarded the promise returned by asynchronous filtering. Completion was reported too early and failed updates had no owning rejection handler. Publication now waits for every target list, reports current synchronous and asynchronous failures, ignores retired failures, and preserves a newer snapshot queued by a list observer. Loading state is cleared in the same update as the source rather than through a separate render.

The library passes 163 specs and lint. After installing `817594f9e2f6978dda037a95862f56290cfcd026` through npm, the integrated Windows run passes 537 specs in 81.829 seconds; this includes both the earlier asynchronous-option fix and the new long-highlight worker regression. The editor audit reports zero vulnerabilities. Core changes are in `054e8263e4`, its library pin is `21407abc7b`, and explorer publication handling is in `7b0121d`. Remote validation is recorded in the [library CI run](https://github.com/lumine-code/fuzzy-search/actions/runs/39896863539) and [explorer CI run](https://github.com/lumine-code/fuzzy-explorer/actions/runs/39897078426); the local integration result is not a claim about those runs' eventual outcomes.
