# Work — quickstart-now/hejbro#865

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — a ledger carrying row-level security is refused where its identity is judged

_2026-09-05T20:52Z_

Built. The identity probe now selects `relrowsecurity` and
`relforcerowsecurity` beside the relation's kind and persistence, and
`LedgerIdentity` gained a `filtered` kind carrying the state
(`enabled`, `forced`, or `enabled and forced`), the connecting role and
the policies. `assertLedgerNotOccupied` throws `apply-ledger-filtered`
for it, so all four ledger-touching commands refuse without a single
call site changing -- the delta asks for the judgement to be made where
identity is judged, and that is literally where it is made. Shape wins:
a relation that is not the ledger is still `apply-ledger-occupied`.

Measured, and worth keeping.

1. The hot path did not widen. The policy list and the role are read by
   a second catalog statement sent only when the probe reports either
   flag, and a test asserts that statement is **not** sent otherwise --
   a performance decision usually survives only as a comment, and this
   one fails loudly instead.

2. The second statement reuses the file's own idiom rather than
   inventing one. An `array_agg` shape was proposed so a zero-policy
   ledger would still return the role; it was replaced by
   `select current_user, p.policyname from (select 1) as one left join
   pg_policies p on ...`, the same left-join-with-nulls pattern
   `PROBE_SQL` already uses for a relation with no columns. It always
   returns at least one row, one row per policy, so a policy name
   containing a comma survives and no driver has to parse an array as
   text -- this file's own `isTrue` exists because text-mode drivers are
   real. Starting from `(select 1)` also survives the relation vanishing
   between the two statements.

3. Row-level security with no policy is a default deny, so the message
   says so ("it carries no policy at all, so every row is hidden from
   that role") instead of rendering an empty list -- the same reasoning
   `apply-ledger-occupied` uses for "no columns".

4. Five mutations, one per claim. The pair that matters reads only one
   of the two flags each way: without both, an implementation that
   checks `relrowsecurity` alone passes every other test.

5. The live witness names the policy. Asserting the refusal alone would
   pass for an implementation that never read the catalog a second time;
   naming the policy proves the read happened. `status` exits one and
   `migrate` exits two on a forced-RLS ledger, and the pending
   migration's objects are absent from the catalog.

6. `pnpm check:diagnostic-xref` went from 252 to 253 defined codes,
   which is the mechanical proof the new code is registered rather than
   spelled somewhere by hand.

