---
"@hejbro/core": minor
---

A core-built set operation (`select(a).union(select(b))`, and its sibling combinators) now types `handle.execute(...)`'s result the same way the chain surface already does: the left branch's keys, each column the union of both branches' declared read types, and a column nullable when either branch declares it nullable or left-joins the table it reads from. A nested set operation, on either side (`(a union b) except c`, `a except (b union c)`, any depth), resolves through its own inner stage first. A `SetOpStage<...>` written by hand as a type annotation carries no branches to resolve, so it keeps reading as the left branch's declared row with joins untracked, unchanged.
