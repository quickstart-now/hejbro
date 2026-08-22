---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Index declarations gain three capabilities they lacked: an access method (`index().using("gin" | "hash" | "gist" | "spgist" | "brin" | "hnsw" | "ivfflat")`, with `btree` the unchanged default), an operator class per column (`op(column, "jsonb_path_ops" | "gin_trgm_ops" | …)`, composable with `asc`/`desc`), and expression indexes (`.on(sql\`lower(${t.email})\`)`, requiring an explicit index name since there's no column to derive one from). Every invalid combination — an unknown method, `unique` on a non-B-tree method, an invalid operator-class identifier, an expression referencing another table or a subquery, an unnamed expression index — fails at declaration time with a message naming the fix. Expression columns are stored in the snapshot as structured nodes, so `--rename` retargets the identifiers inside them exactly like partial-index predicates and CHECK expressions already do. A 0.1.1 project that only uses B-tree indexes regenerates unchanged: the snapshot format stays 5, and the new fields are additive and absent by default.
