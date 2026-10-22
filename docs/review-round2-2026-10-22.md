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
