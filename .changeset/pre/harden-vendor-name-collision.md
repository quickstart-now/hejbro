---
"hejbro": patch
---

`vendor` and `pull` refuse to emit a contract that carries two tables of one SQL name in different schemas (`vendor-table-name-collision`, `pull-table-name-collision`), naming every colliding name with its qualified tables, instead of writing a `contract.ts` that does not compile (#1004).
