Refs:
- openspec/changes/add-set-operations/proposal.md @ blob b7d511ce2013197fb303808d0fdbb5d1aa88fa62
- openspec/changes/add-set-operations/design.md @ blob 151a3f4685503502d95d83456a732b5b0042be9e
- openspec/changes/add-set-operations/tasks.md @ blob 2fe40771ea76f1230618e9cc239cbbf5b24b9d6d
- docs/specs/2026-08-19-hejbro-design.md @ blob e41211b9974ce5f78c0b90431ec8e99f58126829

# add-set-operations proposal — five settled, two parked, one recon audit

Proposal record for the first of #299's three changes (D103), opened
the same day add-relational-reads archived. Lead-run brainstorm; the
recon was one Explore agent whose report the lead spot-verified
(three claims) before the first question — and then, mid-brainstorm,
the owner asked for MORE verification.

## Owner inputs (English rewrites)

1. The queue ran root-first: scope/phasing before any node-shape
   question, because the answer decided whether the CTE fork needed
   settling at all. The owner took the three-change decomposition.
2. After the second decision (SetOpNode as a variant), the owner
   interjected: "it seems worth double-checking whether the explorer
   got things right." The lead re-verified the remaining load-bearing
   claims in-file — the seven statement-node sites by coordinate, the
   eleven expression-node sites by spot-check, the D102 `with()`
   reservation verbatim, the `FamilyReadType` `never` tail, the
   view-kind branch absence, the `NestedReadMarker` coordinates —
   and published the verification table before continuing. All held
   (one minor line drift). The queue resumed only after that.
3. Views: the owner allowed set-ops into view bodies with the codec
   completed (vocabulary, no bump) over the query-layer-only
   asymmetry.
4. Typing: compatibility enforcement over left-wins.
5. Aggregates: the owner explicitly widened #416 to carry the FULL
   aggregate surface including `groupBy`/`having`, against the
   recommendation to park plain aggregates as a fourth sub-issue —
   the window change's proposal now owns budgeting the
   `SelectNode`-field silent-drop axis that ruling pulls in.

## What was parked, and where

D4 (window IR form: new `WindowNode` vs `FunctionCallNode.over?` —
the latter is a field-shape change to a snapshot-reachable node and
would force v8) lives in #416's body; D5 (the CTE from-source fork:
`FromNode` union vs a `with` side-channel — `TableRefNode` cannot
name a schema-less CTE) lives in #417's body. Both carry enough of
the recon to reopen cold. #299 became the umbrella with three
sub-issues (no-orphan rule); its own "IR in @hejbro/query" wording is
restated in D94 terms by the proposal.

## The physics that decided D103's node question

The g2/g3 landings measured the asymmetry this row leans on: a new
node VARIANT breaks compilation at every mapped-type site (eleven for
ExprNode, seven for QueryNode), while a new `SelectNode` FIELD is
silently dropped by the codec's fixed seven-key literal, the
renderer's clause list, retarget equality, walk child extraction, the
lifter, column-order, and view serialize. `(a union b) except c`
needing recursion closed the case.
