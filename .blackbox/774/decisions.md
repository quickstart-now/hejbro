# Decisions — quickstart-now/hejbro#774

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Q6: identity groups placed as one unit, kind order kept; new capability snapshot-diff

_lead · extension · basis D1 · 2026-09-04T13:05Z · ratified: pending_

Q6 — rule (a), preserve: `refineByDependsOnIdentities` groups changes by identity and places each group as one unit in the wave order, keeping the kind's reported order and adjacency inside the group; nothing is dropped and nothing is placed twice. Refusing with a coded error (b) would make core stricter than the extension interface it publishes (a kind may report several changes for one identity), so it is rejected. Location (ii): a new capability `openspec/specs/snapshot-diff/` (ADDED), with its Purpose written in the same commit that creates it (OpenSpec first-creation rule) — the contract belongs to core's diff engine as a surface for presets, and no built-in kind can produce a CLI scenario for it, so the `cli-commands` generation requirement is the wrong home. Kinds without `dependsOnIdentities` are already preserved and appear only as control rows.

