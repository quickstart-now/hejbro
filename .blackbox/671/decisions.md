# Decisions — quickstart-now/hejbro#671

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — harden-adoption: adoption creates the table's additive children, normalizes a leftover sequence idempotently, and generate names what it will create

_lead · extension · basis 412/D24, D25; ruling J10 (adoption creates what hejbro manages); the owner's detect-and-name rule (no silent prevention); #694's analysis of fixes A and C; #671 and #668 measurements · 2026-09-05T05:53Z · ratified: pending_

Design (design.md Q1-Q3): (a) for #671 -- indexes, checks, FKs, PK created on adoption, never drops; C scoped by the transition for #694 -- the diff engine's owner-transition knowledge reaches the sequence kind, `create sequence if not exists` + alters on an adopted owner only; `adoption-creates` notice for #668 with the baseline Next. table-declaration MODIFIED; cli-commands ADDED. Ratification: owner on return.

