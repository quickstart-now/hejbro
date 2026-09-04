# Decisions — quickstart-now/hejbro#300

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — Owner context

_owner · 2026-08-29T00:00Z_

The owner was absent for this change. Two owner-set facts framed it, and a
standing delegation covered the rest.

**Fact one — the piece was already inside a gate the owner set.** The owner
had settled that 0.2.0 means every sub-issue of #282 closes. #300
(`@hejbro/neon` preset with driver) is one of them. That matters because
`@hejbro/neon` also appears under "Deferred" in the design spec's v1 cut
(D98), and building a Deferred item is an owner-approval hard gate. The two
statements are not in conflict: D98 deferred it *from v1* and parked it as
an issue; the owner then placed that issue inside the 0.2.0 gate. The lead
recorded this judgment explicitly rather than letting the team infer it, and
flagged it for owner confirmation on return.

**Fact two — the design spec already anticipated this package.** D95's
package map is written as `@hejbro/supabase|neon|nile`, and it names
`@neondatabase/serverless` as the client a Neon driver would wrap. So the
change applies three existing decisions (D95, D96, D98) and revisits none.

**Delegation.** In the owner's absence the lead held merge, planning, and
owner-decision authority for openspec artifacts, until the owner declares
return. Every decision below marked "ratified" was ratified by the lead
under that delegation, not by the owner directly.

