# Decisions — quickstart-now/hejbro#531

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Direction 1: correct the contract wording, no pg code change

_lead · interpretation · 2026-09-03T00:00Z · ratified: pending_

Ledger R11.

#531: what binds late is the member, the object is composed at construction time, and a spread decorator runs its own hook. The contract text is corrected; the pg code is unchanged.

<a id="r2"></a>
## R2 — A type pin's expected value comes from an independent path

_lead · extension · 2026-09-03T13:00Z · ratified: pending_

Ledger R39.

qc review round 2: the pg test file may be edited (spread-decorator observer, src unchanged). A tautological type pin is replaced — rule: the expected value of a type pin is obtained by an independent path (for example the left branch executed alone), never the type expression the implementation uses.

<a id="r3"></a>
## R3 — qc #737 merges on green CI without the reviewer's final light pass

_lead · extension · basis R41 · 2026-09-03T13:50Z · ratified: pending_

Ledger R53.

Pending ratification: with every opus teammate stuck on API 529s, qc's PR #737 merges on green CI without the reviewer's final light pass. Grounds: (1) the reviewer confirmed at 342a170d that the three blocking findings were closed, with five mutants and an 18-row battery measured; (2) the changes since are delta wording — the reviewer's own proposed text, cross-checked character by character by the lead — and the README restamp; (3) CI, isolated, runs the same gates as the reviewer's heavy set (test, crap 0/1631, smoke, build). The reviewer's heavy set is skipped to save the slot.

