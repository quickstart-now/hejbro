# Decisions — quickstart-now/hejbro#712

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — harden-catalog-inference-2: roles from policies too (public excluded); an enum name is held to D36 and omitted with its columns

_lead · extension · basis 412/D24, D25; the requirement's own one-rule sentence for identifiers; #678's measurement (pg_policies.roles never read); #712's finding (pgEnum asserts nothing) · 2026-09-05T05:55Z · ratified: pending_

Design (design.md Q1-Q2): pg_policies.roles joins the inferred role union, `public` dropped; an enum whose catalog name D36 rejects is omitted together with every column typed by it, one report line naming both with the check consequence. catalog-inference: two MODIFIED requirements. Constructor-mode review (catalog input). Ratification: owner on return.

