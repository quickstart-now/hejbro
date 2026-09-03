---
"@hejbro/core": patch
---

Internal: the rename planner (`engine/rename-plan.ts`, 2,129 lines) is decomposed into cohesive modules under `engine/rename/` — no behavior change, no API change; the module path and every export stay put.
