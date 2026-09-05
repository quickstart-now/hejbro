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

