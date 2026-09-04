# Decisions — quickstart-now/hejbro#528

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The conformance kit's obligation follows the spec sentence; a same-transaction pin observation is added

_lead · interpretation · 2026-09-03T00:00Z · ratified: pending_

Ledger R10.

#528 gap 1: the kit's obligation is aligned with the spec sentence ("some statement precedes"), the wire observation stays, the tsdoc is corrected. Gap 2: a same-transaction pin observation is added, with every driver in the repository as a control group.

<a id="r2"></a>
## R2 — Kit: report the false tier as wording only; envelope observation is the third required shape

_lead · extension · 2026-09-03T07:55Z · ratified: pending_

Ledger R21.

The kit reports the false tier as "no preceding statement" wording only (code kept); the envelope observation becomes the third required shape (the statement list emitted on the connection plus the caller's statement); boundary recognition is a whole-statement match of SQL vocabulary, case-insensitive, with an in-body `begin` as the control.

<a id="r3"></a>
## R3 — Kit changes need three mutant killers before a reviewer is summoned

_lead · extension · 2026-09-03T08:50Z · ratified: pending_

Ledger R26.

A change to the kit (an instrument) does not summon the reviewer without evidence that three mutants are killed.

<a id="r4"></a>
## R4 — Boundary recognition by normalised leading keyword; set-op delta corrected to actual behaviour

_lead · extension · 2026-09-03T12:20Z · ratified: pending_

Ledger R35.

qc review round 1: (1) the kit recognises a boundary by the normalised leading keyword (opening: begin, start transaction; closing: commit, rollback, abort, end; `rollback to savepoint`, `savepoint`, `release savepoint` are not boundaries), stated as a requirement. (2) set-operation execution typing keeps `UntrackedJoins` and the delta is corrected to the actual behaviour (object-projection columns gain null, since the stage carries no left-join record). (3) left-join tracking pass-through goes to #738 as a comment (same root).

<a id="r5"></a>
## R5 — Transaction ends inside a batch string are not recognised; stated honestly

_lead · extension · 2026-09-03T13:55Z · ratified: pending_

Ledger R43.

qc review round 3: a transaction end inside a batch string (`set …; commit`) is not recognised by the kit and is not hardened now (it needs a dollar-quote- and literal-aware splitter; a first-segment heuristic is half a solution). Honesty through the tsdoc limitation and the delta sentence "batches are not split". No follow-up issue.

<a id="r6"></a>
## R6 — A sentence refuted twice is removed, not corrected a third time

_lead · extension · basis R34 · 2026-09-03T15:35Z · ratified: pending_

Ledger R49.

After the third counter-example to the batch sentence: the description of batch results is deleted from the requirement and the tsdoc, leaving only the observation rule ("first whitespace-delimited word; no split on semicolons"). Rule: when the same sentence is refuted twice, the third correction is to remove it (a consequence of R34). Reinforcement: a mechanism sentence is true only with its normalisation ("trimmed, lower-cased, stripped of any trailing semicolons; never split on an interior `;`") — the reviewer refuted the lead's draft with six rows; the fragility (a pipeline description) is recorded in the PR body.

