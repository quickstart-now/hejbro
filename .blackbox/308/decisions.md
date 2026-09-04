# Decisions — quickstart-now/hejbro#308

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-28T00:00Z_

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

