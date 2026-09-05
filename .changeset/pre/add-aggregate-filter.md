---
"@hejbro/core": minor
---

Add `filter(aggregate, condition)`, a real `FILTER (WHERE …)` constructor for `count()`/`min()`/`max()`/`sum()`/`avg()` — the aggregate keeps its own declared result type and conversion, the condition's runtime values lift to bind parameters like any other condition, and it composes with `over(...)` in the one order SQL allows (`over(filter(count(), condition), spec)` renders `count(*) filter (where …) over (…)`).
