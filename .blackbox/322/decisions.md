# Decisions — quickstart-now/hejbro#322

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — Owner decisions carried in

_owner · 2026-08-27T00:00Z_

The two [design] tasks were owner-settled before the team was
summoned: STRICT write unions (the write type is the declared read
type exactly; convenience is a mode declaration, never a widened
union) and the always-full IntervalStyle-postgres serialization form.
Mid-group the lead ruled six escalations from the owner's settled
principles — serializeInterval lives in core (the D94 IntervalValue
precedent), STRICT applies only where a write path exists (json/jsonb
and bytea stay explicitly `never`, sql`` remains the escape hatch;
datetime narrows to `Date`, zero broken call sites measured), (F) new
literal kinds carry canonical text in the AST (JSON-serializability is
a global AST invariant — `JSON.stringify(1n)` throws inside the
plpgsql body-determinism guard, and core's own Date→isoValue precedent
was the answer), (D) parseInterval's `-0` on every zero subfield of a
negative time axis is normalized to `+0` (a live read defect — most
negative intervals hit it; the real-server anchor `-00:05:00` came
from group 1's docker harness), (E) the delta's round-trip sentence is
qualified "normalized within each axis", and the `$n::interval` cast
follows the `timestamptz` precedent.

