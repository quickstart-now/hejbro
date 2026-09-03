---
"hejbro": patch
---

`hejbro check` no longer reports every `serial`/`smallserial`/`bigserial` column as missing its default (#716). The column's `nextval(...)` default lives on the snapshot's own synthesized sequence, not on the column itself — `check` now joins that sequence and accepts the catalog's `nextval(...)` text whether or not it is schema-qualified.
