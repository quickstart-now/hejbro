---
"hejbro": patch
---

`hejbro import`/`pull` now read a stored generated column as a
generated column instead of losing it silently, and a column an
omitted name or enum type takes with it now takes every index, check
constraint, UNIQUE constraint and generated column that names it along
too — a generated column dropped that way then drops its own index,
check constraint, UNIQUE constraint, primary key and foreign key in
turn, each named on its own loss-report line. The loss report's own
remedy line now says to either re-run `hejbro import` into a fresh
`--out` and merge the new declaration, or add it by hand, and a
UNIQUE constraint dropped for its own name is announced as a unique
constraint rather than a plain index. `hejbro pull`'s own approximation
lines for a foreign key or a primary key under a derived name now say
only what the pulled contract carries, never a promise about
`generate`/`check`, commands a pull consumer never runs; and `pull`'s
own "pulled ..." line and lock file no longer name a schema its
reading omitted whole.
