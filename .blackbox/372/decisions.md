# Decisions — quickstart-now/hejbro#372

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-28T00:00Z_

1. The owner supplied an external AI review of the repo's agent
   tooling (13 findings) and asked what the lead thought of it. The
   lead verified each claim against the repo before answering: ten
   confirmed outright; finding 5 ("the reviewer is the author") was
   factually wrong about the current piece-team process but right
   about the missing framing-independent layer; finding 10 (a
   `snapshot upgrade` command) was partially misdiagnosed under the
   declaration-is-truth model (snapshots regenerate; the real need is
   a written format-stability policy). The meta-diagnosis — dense on
   production, holes in independent verification and the user-facing
   surface — was endorsed with the lead's own evidence (#361 as the
   pattern's prior instance).
2. Asked where the adopted items should live, the owner ruled: into
   the #282 gate — "0.2.0 slipping is fine." Eight issues filed
   (#372–#379).
3. The owner then set the orientation: "I prefer root-cause
   solutions." This issue (#372) was upgraded on that direction from
   three policy one-liners to a class-level fix.

