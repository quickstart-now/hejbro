# Work — quickstart-now/hejbro#413

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — upgradeSnapshot takes the registry, not a required-keys map

_2026-09-05T04:49Z_

canonicalizeSnapshot's real signature is `canonicalizeSnapshot(snapshot: Snapshot, registry: KindRegistry): Snapshot` (packages/core/src/snapshot/snapshot.ts:207-229) -- it needs a full KindRegistry, not the plain `ReadonlyMap<string, ReadonlyArray<string>>` that `requiredKeysByKind(registry)` (packages/core/src/kind/registry.ts:237-245) produces.

Measured directly (Stage A, task 1.1): re-encoding the 0.1.1-tagged format-5 `table-constraints` golden expected snapshot and diffing it against today's expected snapshot shows the only non-formatVersion difference is the `checks` array's *order* -- two check-constraint objects, byte-identical content, swapped position. That reordering is exactly what `tableKind.canonicalize` (packages/core/src/kinds/table-kind.ts:601-609, `canonicalizeTable`, #701/D3) does: it sorts `indexes` and `checks` by name. Nothing else in any of the 10 byte-identical golden cases differs beyond that and the known additive fields (`distinct`/`groupBy`/`having`/`offset`, all decode to their empty value when absent).

Conclusion: upgradeSnapshot's "brought to the canonical form" step is not optional plumbing -- it is load-bearing for the byte-identical oracle itself, and it requires calling each object's own kind.canonicalize through a real KindRegistry. A registry built internally via `createDefaultRegistry()` (core-only kinds) would silently skip canonicalize for any preset-declared kind (e.g. a Supabase-only kind) carried in a format-5 snapshot, undermining the ADDED requirement's idempotence claim for any input outside core's own kind set. Settled (lead ruling via su-planner): `upgradeSnapshot(raw, registry, requiredKeysByKind?) -> { text, fromVersion }` -- the caller's own registry (already built for every other command via `buildRegistry(config)`) is passed in, exactly like `canonicalizeSnapshot`'s existing pattern. `parseSnapshot`'s own 2-argument shape (kept plain-map-only, no registry) is unaffected -- the requiredKeysByKind doc comment's coupling concern was about parseSnapshot needing only string-list data; upgradeSnapshot genuinely needs kind behavior, so that precedent does not transfer.

<a id="w2"></a>
## W2 — spike: generic queryKind/nodeKind decode-encode walk fixes both failing golden cases, no-op on every current-format file

_2026-09-05T05:03Z_

Spike only (su-planner directive) -- scratch script run via tsx from /private/tmp scratchpad, never committed, not in the worktree.

Hypothesis tested: a generic normalization pass -- recursively walk a parsed snapshot's objects, and wherever a JSON object literal carries `nodeKind` (an ExprNode) or `queryKind` (a query node), decode it through the matching codec (`decodeExprNode`/`encodeExprNode`, or `decodeQueryNode`/`encodeQueryNode` for `select`/`set-op`, or `decodeWithNode`/`encodeWithNode` for `with`) and replace the subtree with the re-encoded result -- run once, before `canonicalizeSnapshot`, fixes the two failing golden cases and is a no-op on every current-format snapshot.

Result 1 (effect): all 10 golden cases MATCH byte-for-byte after adding this pass, including the two that failed with canonicalizeSnapshot alone (app-security, column-insert-mid).

Result 2 (fixed point): ran the same normalization + canonicalizeSnapshot + renderSnapshot pipeline over all 16 current-format snapshots that exist in the repo today (14 golden expected/snapshot.json + both examples) -- every one is byte-identical to its own input (FIXED POINT). No current-format file changed.

Result 3 (out-of-sample field survey): ran the walker over all 12 format-5 fixtures and logged which snapshot fields actually carry a nodeKind/queryKind subtree. Confirmed fields, none unexpected: table `columns[].default` (nodeKind:function-call/literal), table `checks[].expression` (nodeKind:comparison/in-list/between/sql-template), table `indexes[].where` (nodeKind:comparison), policy `using`/`withCheck` (nodeKind:exists/comparison/null-test/logical/literal), view `query` (queryKind:select). No `queryKind:with` subtree occurs in any of the 12 format-5 fixtures (0.1.1 predates CTEs), so the `with`-dispatch branch (decodeWithNode/encodeWithNode, needed because encodeQueryNode/decodeQueryNode's own dispatch is deliberately narrow to select/set-op per codec.ts:996-1002) is wired in the spike but unexercised by this oracle -- a real risk area for any future case that does carry a `with` node, structurally important but unmeasured here.

Zero exceptions across all 12 fixtures' full object trees.

Conclusion for the lead's ruling: the round-trip a format bump needs is not reachable through the existing per-kind `canonicalize` hook (view-kind has none, policy-kind's only sorts roles, table-kind's only sorts indexes/checks) -- it lives in the expr/query codec, and a **generic, kind-agnostic** recursive walk over the two node-shape discriminators reaches every field that needs it without hardcoding per-kind field names, and is provably inert on data the writer already produces in full.

<a id="w3"></a>
## W3 — spike addendum: neither with nor set-op queryKind appears in any current-format file

_2026-09-05T05:05Z_

Follow-up measurement on W2's spike: grepped all 16 current-format snapshots (14 golden expected/snapshot.json + both examples) for `"queryKind"` values. Only `"select"` appears anywhere; neither `"with"` nor `"set-op"` occurs in any of them.

Consequence: the spike's Result 2 (fixed point over all 16 current-format files) never exercised the generic walker's `with`/`set-op` dispatch branches -- both are unverified by any file-based oracle available in this repo today, not just `with` alone as first noted. Neither branch can ever be exercised by a vendored fixture (0.1.1 predates CTEs, and no golden case's declarations use a set operation), so covering them needs an in-memory constructed input (buildSnapshot over a declaration set that includes a CTE view and a union/except/intersect view), not a file. Held pending the lead's ruling on (A) vs (B); if (B) ships, this coverage gap becomes its own task.

<a id="w4"></a>
## W4 — 1.1b: generic discriminator-driven normalization closes the byte oracle

_2026-09-05T07:13Z_

Implemented the recursive normalization pass ruled on in R2 (lead ruling via su-planner): normalizeDiscriminatedNodes walks a parsed snapshot's objects and, on encountering an object literal carrying `nodeKind` (an ExprNode) or `queryKind` (a query node), round-trips it through its own codec (decodeExprNode/encodeExprNode; decodeQueryNode/encodeQueryNode for select/set-op; decodeWithNode/encodeWithNode for with) and replaces the subtree, run inside upgradeSnapshot before canonicalizeSnapshot. Node recognition is by discriminator field only, no per-kind field list.

Refactor during green (su-planner review): the first working version imported view-kind.ts's own encodeViewQueryNode/decodeViewQueryNode wrapper for the with/non-with dispatch -- functionally correct (same underlying codec calls) but made the generic normalizer depend on a specific kinds/ module, contradicting 1.1b's own "recognise by discriminator only, no kind-specific dependency" constraint. Replaced with the same three-way dispatch built directly from expr/codec.ts's own exports (decodeQueryNode/encodeQueryNode, decodeWithNode/encodeWithNode), removing the kinds/view-kind import entirely -- snapshot.ts now only depends on expr/codec.ts for both the expression and query axes, symmetric.

CRAP gate caught a second issue after that refactor: folding the with/non-with dispatch into normalizeDiscriminatedNodes's own body raised its cyclomatic complexity to 6 (CRAP 6.00 at 100% coverage -- complexity alone over the threshold, not a coverage gap, so no test could fix it). Split the queryKind dispatch into its own normalizeQueryNode helper; both functions now sit at exactly complexity 5 (CRAP 5.00, at the gate's own threshold, matching the pattern already used elsewhere in this file, e.g. applyCanonicalize split out of buildEntry).

Result: 45/45 tests green (T1 12 + T2 10 golden byte-oracle + 4 in-memory queryKind fixed points [with/union/except/intersect, none present in any committed snapshot] + T3 15 + T4 4 refusal rows), full pnpm test (@hejbro/core: 101 files / 1726 passed + 1 todo), all custom gates (bans, next-marker, diagnostic-xref, crap) green.

<a id="w5"></a>
## W5 — 1.2: older-format message splits on the release floor

_2026-09-05T07:32Z_

Split parseSnapshot's older-format diagnostic on HEJBRO_UPGRADABLE_SNAPSHOT_FLOOR (5): below it (a format no release ever wrote) keeps olderVersionMessage's pin-or-reset guidance verbatim, unchanged; at or above it (5, 6, 7 -- this build's own snapshot history) a new olderReleasedFormatMessage names `hejbro upgrade` and never mentions pinning or resetting. olderFormatMessage is a small if-only dispatcher (no ternary) between the two, called from validatePresentFormatVersion; validateMissingFormatVersion (the pre-formatVersion-key path) is untouched since it is always below the floor.

Verified the split doesn't break 1.1's T4 (upgradeSnapshot's below-floor/newer refusals carry the ordinary read's exact code+message): upgradeSnapshot's own validateUpgradeableFormatVersion calls olderVersionMessage directly for its below-floor branch, exactly what olderFormatMessage itself calls for the same input -- same function, same argument, same string.

Red confirmed by actual revert-and-rerun (not just written-then-passed): reverted validatePresentFormatVersion's call back to olderVersionMessage, reran the new 5-row table -- the 3 released-format rows (5/6/7) failed exactly as expected, the 2 below-floor rows stayed green. Restored the fix; all green again.

Added a further assertion after su-planner review: each row also asserts the message names the exact version mismatch found ("snapshot version <v> is older than this build supports (expects 8)") per the delta scenario's "naming the version mismatch" clause -- catches an implementation that names `hejbro upgrade` without saying which version was found.

Test file: packages/core/test/snapshot.test.ts (existing version-message file, per tasks.md's own allowance), new describe "the older-format message splits on the release floor (#413)", 5-row it.each table. All gates green: pnpm check, check-types (18/18), full pnpm test (@hejbro/core: 101 files / 1731 passed + 1 todo), check:bans, check:next-marker, check:diagnostic-xref, check:crap (44 at threshold, no violations).

Note: an early full `pnpm test` run failed on `preset-smoke` with "Failed to resolve entry for package @hejbro/core" -- self-inflicted: I had `TURBO_FORCE=1 pnpm check-types` (which rebuilds core's dist) running concurrently with `TURBO_FORCE=1 pnpm test` in the background, racing tsdown's clean-then-rewrite of packages/core/dist against preset-smoke's module resolution. Not a product defect. Fixed by running `pnpm build --force` then `pnpm test` sequentially, with nothing else touching dist concurrently -- confirms these gates must not be run in parallel against the same worktree's dist.

<a id="w6"></a>
## W6 — 1.3: the -- upgraded-from: banner line and its parser

_2026-09-05T07:49Z_

Added the -- upgraded-from: banner line (R3 contract): prefix "-- upgraded-from: ", rendered directly under -- snapshot: only when renderBanner's new optional 5th parameter (upgradedFrom?: string) is given. parseBannerUpgradedFrom(fileContent): string | null reads it by prefix only (same reasoning as parseBannerBaseline's own doc comment -- matching the whole line would misreport absence the moment the prose after the prefix changed). parseBannerHashes is untouched and continues to return the current pair unaffected by the new line's presence (verified by test, not just asserted -- different prefix, no code change needed there).

R3's "keeps one line, first hash" requirement: renderBanner has no memory of a file's previous contents (it always renders fresh from its own explicit parameters), so "one line" holds by construction -- there is no code path that could produce two. The interesting half of the requirement -- that a second upgrade's caller passes the ORIGINAL hash forward, not the one just replaced -- is a 1.4 (CLI) concern; 1.3's own test demonstrates the property at the migration-file.ts level: render with upgradedFrom=X, change only the current snapshot hash (simulating what a second upgrade would do to the hash-chain lines), re-render with the SAME upgradedFrom=X -- output still carries exactly one upgraded-from line, value X, parser returns X.

Export pin: parseBannerUpgradedFrom exported from packages/core/src/index.ts, classified ENGINE (not VOCABULARY) in packages/cli/src/core-surface.ts per su-planner's direction -- unlike parseBannerHashes/parseBannerVersion/parseBannerBaseline (VOCABULARY, documented in the generate/verify workflow skill as user-facing), this one is CLI-internal machinery for history/restore resolution (1.5), not (yet) a documented end-user surface.

File path note: tasks.md names packages/core/test/sql/migration-file.test.ts and packages/core/test/exports.test.ts; neither exists at that path. Used the actual existing files instead: packages/core/test/migration-file.test.ts (flat, matches every other parseBanner* test already there) and packages/cli/test/exports.test.ts (core's own export-pin/classification gate; there is no packages/core/test/exports.test.ts in this repo). Same file-path-mismatch pattern already seen in 1.1/1.2.

Gates: pnpm check, check-types (18/18), full pnpm test (@hejbro/core: 101 files / 1739 passed + 1 todo; preset-smoke passes -- confirms the 1.2 dist race was self-inflicted, not systemic), check:bans, check:next-marker, check:diagnostic-xref all green on the first run. check:crap failed once on an unrelated flake (test/cross-instance-symbols.test.ts's duplicate-module-loading test timed out under coverage instrumentation load, nothing this task touches) and passed clean on an immediate retry -- 44 functions at the threshold, no violations.

<a id="w7"></a>
## W7 — 1.4: hejbro upgrade — check:next-marker forced error-construction sharing, not just message sharing

_2026-09-05T08:20Z_

scripts/check-next-marker.mjs's resolveMessageText only follows a message argument to a same-file `const` declaration (findDeclarationText scans the current file's own text). The first version of commands/upgrade.ts's chain-tip-mismatch precondition imported verify.ts's chainTipMismatchMessage and called throwHejbroError("chain-tip-mismatch", chainTipMismatchMessage(...)) at the import site -- the checker found the throwHejbroError call in upgrade.ts, but could not resolve the message argument across files, and failed with "could not locate the message literal".

Verified manually (the checker's own suggested fallback) that the message text does carry Next: -- this was a real gate limitation (cross-file import resolution), not a missing Next: clause.

Lead ruling (via su-planner): do not accept the gate red, do not duplicate the message text in upgrade.ts, and do not extend the shared checker script for one call site. Instead move the error CONSTRUCTION (not just the message) into verify.ts: chainTipMismatchError(tipMigrationPath, snapshotPath) -> HejbroError wraps hejbroError("chain-tip-mismatch", chainTipMismatchMessage(...)) in the same file as chainTipMismatchMessage's own declaration, so check-next-marker's same-file resolver sees code+message paired and passes honestly. verify.ts's own check 4 now calls this too (previously had its own separate hejbroError(...) call with the identical arguments), so the two commands are now provably unable to drift in that they build the literal same HejbroError value. upgrade.ts imports only chainTipMismatchError and never holds the "chain-tip-mismatch" string or the message text itself -- a reviewer scanning upgrade.ts for a bare code+message pair will correctly find none, by design.

The cross-file resolution gap in check-next-marker.mjs itself is a real, separately-tracked limitation -- the lead is informed via su-planner; not filed as an issue by the implementer per instruction.

