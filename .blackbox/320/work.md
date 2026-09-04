# Work — quickstart-now/hejbro#320

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-query-layer group 1 — array conversion and driver override

_2026-08-27T00:00Z_

Piece team hg1 (planner opus, implementer sonnet, reviewer opus),
worktree `harden-g1-arrays` off dev `0318d8a` via the branch-prep
commit `5cc5129` (which carried the change-wide uniformity RENAMED
block for #326 — deliberately left untouched by this group and landed
here), tracking issue #333, sixteen team commits (tip `aa36794`,
rebased clean onto dev `fec58f9` as `8394eb5`) plus this close-out.
Issues #320 and #323.

### What landed

A pure Postgres array-literal text parser (`array-text.ts`: quoted
elements, escapes, `NULL` vs `"NULL"`, empty array, five rejection
guards each bound down to its reason); element-wise result conversion
in `convert.ts` dispatched by the DECLARED element type — the initial
implementation sniffed the runtime shape (`typeof`/`Array.isArray`)
and the review proved that to be an observable defect, not a style
point: a driver breaking its arrival contract passed silently in both
directions. The corrected shape treats declared type as the only
dispatch and fails fast on both mismatch directions with the column
name and the new `unexpected-array-arrival-shape` cause. `@hejbro/pg`
extends its per-query text override from 1186 to 1187 and — after a
mid-group escalation — 1231, and the checkout pin now calls the
driver value's own `setupSession` member (late-bound, #323), so
decorator-wrapped hooks take effect; the six pin scenarios stayed
untouched-green.

### The numeric[] escalation

During batch B the implementer found that pg's default parser
`parseFloat`s `numeric[]` elements (oid 1231) while scalar `numeric`
(1700) and `bigint[]` (1016) stay text — so the change's own
driver-contract delta sentence ("an array of decimal text elements")
was false for `numeric[]`, and a `mode:'string'` array column — the
DEFAULT — silently destroyed precision (review reproduced nine
fabricated significant digits on a real database, no error). The lead
approved extending the override to 1231 in-group: the approved
proposal's goal (#320, element-wise conversion to declared types) is
unreachable for default-mode numeric arrays without it, and the
alternative shipped silent data corruption into 0.2.0. The false
delta sentence was corrected in 1.6 — never archived. Real-database
red/green both ways: the reviewer checked out the pre-fix sources in
place, reran the docker suite, and watched the trailing-zero loss and
digit fabrication reproduce, then die under the fix.

### Review economics of this group

Batch A went through one rework whose findings shared a single root:
assertions that did not check the reason. Both arrival-shape guards
could be killed (`if (false)`) while all tests passed, because an
accidental `TypeError` produced the same error code and column name;
the fix was cause codes on the guards plus a `rejects(raw, code,
reasonPattern)` helper, which retired mutations M6/M11a/M11b/IM-2 in
one stroke. Two disciplines hardened here and carry forward: a
mutation submitted as red-substitute evidence must itself be validated
(IM-2 survived and proved nothing), and the reproduction belongs to
the reviewer, not the submitter; and a green run is not evidence until
its cause is checked (the 2.64-second integration pass was
deliberately poisoned to prove a real database answered). Nominal
estimates assume one clean pass — the measured total ran ~240m against
a 50m nominal, with the approved scope extension (~50m), two review
loops (~40m), and docker's real cost (1.5 at 3.75×) accounting for
most of the gap.

### Boundaries recorded, not fixed

`numeric` NaN/Infinity stays rejected in all modes (owner-settled
parse contract; surfaced to the owner as a design-extension candidate,
bound by parity tests either way); multi-dimensional and
dimension-prefixed array text is rejected whole (Non-Goal); the
PostgREST-shaped future (drivers that legitimately deliver parsed JS
arrays for interval[]) is sealed in a convert.ts handoff note — the
contract grows by enumerating arrival shapes explicitly, never by
returning to silent sniffing. Sibling-group escalations during this
window produced #341 (typed integration seed + raw server-text
capture) and #342 (writer∘parser inverse property), both filed by the
lead into the phase gate.

Migrated from the single-file entry `.blackbox/2026-08-27-harden-query-layer-group1.md`, kept verbatim at `.blackbox/320/artifacts/2026-08-27-harden-query-layer-group1.md`.

