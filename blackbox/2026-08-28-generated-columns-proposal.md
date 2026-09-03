Refs:
- openspec/changes/add-generated-columns/proposal.md @ blob e54b97352e44973593d64b0b0229abfa2a4a134c
- openspec/changes/add-generated-columns/design.md @ blob 10781beaa4c453c3c8ce50e6360ba2e2cd6a3a5e
- openspec/changes/add-generated-columns/tasks.md @ blob e1e624add9e5356526c96f1affa8c69125f1c2dd
- openspec/changes/add-generated-columns/specs/table-declaration/spec.md @ blob a1ca59692141a43a5fefddc05f676f1801b8e1ec
- openspec/changes/add-generated-columns/specs/query-type-inference/spec.md @ blob ccde94c891a0b4b11e0826599a1ddbb45cf76e88
- openspec/changes/add-generated-columns/specs/snapshot-format/spec.md @ blob 13937be1adac29cd1764f183a5b2ae03b430bae2
- docs/specs/2026-08-19-hejbro-design.md @ blob 883c685f3d74c7f52747af80e44a49dfbef5716c

# generated-columns-proposal — seven questions, zero design tasks (#308, D100)

OpenSpec change proposal `add-generated-columns` (proposal + design +
three delta specs + tasks, `openspec validate --strict` PASS),
authored by the lead session in worktree `generated-spec` off dev
`92a0c8d`. The PR carrying this entry is the owner's approval gate for
both the proposal and decision-log row D100.

## Owner inputs (English rewrites)

The owner approved the session plan ("proceed"): #361 first, then this
proposal. #308 itself carries the owner's earlier direction
(2026-08-26, during add-query-layer group 3) that generated-column
support start as its own change. The surface was then settled in a
seven-question dd-brainstorming trail (2026-08-28), each question with
background first, one decision per turn:

1. Variant scope → the full trio (stored generated + both identities)
   WITH sequence options. The deciding background fact: under the
   owner's own "0.2.0 ships only when every sub-issue closes" rule,
   deferring is not free (a parked option-support issue grows the
   gate), and sequence options have no escape hatch at all — a user
   simply could not express `START WITH` until a follow-up landed.
2. Method names → Drizzle-parity trio (`generatedAlwaysAs`,
   `generatedAlwaysAsIdentity`, `generatedByDefaultAsIdentity`) — the
   surface reads as the SQL it emits (D57 spirit) and keeps migrator
   muscle memory.
3. Expression argument → a `sql` fragment naming sibling columns. The
   background eliminated both alternatives structurally: a lazy
   callback cannot be typed inside the column map (the Phase-7 TS7022
   thunk rejection precedent), and extras-side declaration hides
   generated-ness from the type layer — fatal, because compile-time
   insert exclusion is the very gap (#308) this change exists to
   close. Superficially opposite to the g1 escalation's structured
   ruling, and the record states why the cases differ: the derived
   CHECK was core-synthesized (structured refs free), this expression
   is user-authored where structured refs cannot exist — the exact
   situation RLS predicates already resolve with fragments.
4. formatVersion → bump 5 → 6. Column-node shape change; older
   readers must refuse via the D73 newer-format diagnostic rather
   than silently dropping fields into a wrong diff; the v3 "정갈하게"
   precedent and the 2026-08-22 bump-rule's own shape-change proviso
   both point the same way.
5. Diff semantics → precise in-place alters for every identity
   transition; drop+add only where Postgres has no universal in-place
   grammar (expression change — derivable data, no confirmation;
   plain→generated — destructive, D32 confirmation). `SET EXPRESSION`
   deliberately unused: it is PG17-only and adopting it would mint a
   minimum-version commitment hejbro has never made.
6. Write typing → ALWAYS-family keys absent from insert/update input
   entirely (the `never`-valued alternative rejected as autocomplete
   noise); by-default identity = `hasDefault` semantics. `OVERRIDING
   SYSTEM VALUE` recorded as a design non-goal, deliberately NOT
   parked as an issue.
7. Witness → create-path grammar + the three runtime behaviors
   (identity assigns, generated computes, the DATABASE rejects an
   ALWAYS write); alter paths golden-covered; examples migration a
   non-goal (serial stays their idiom).

## Artifact shape

Deltas: `table-declaration` gains the declaration/emit/diff
requirement (four scenarios, including the alter-in-place table and
the confirmation asymmetry); `query-type-inference`'s insert/update
requirement gains the family classification; NEW capability
`snapshot-format` enters the spec tree scoped to what this change
settles (version 6, the recorded fields, loud refusal by older
readers). tasks.md: four groups (declaration surface / snapshot+emit+
diff / query typing / pg witness), eight leaf tasks, zero `[design]` —
the full-presettlement prescription that measured zero contract churn
in add-array-ergonomics group 4. Group 4's estimate (15m) carries the
measured integration-harness context cost from that change's ledger.
