---
"hejbro": patch
---

Fix a precision bug in nested reads: a windowed cell (`over(count(), …)`, `over(max(col), …)`, `over(lag(col), …)`, …) inside a `jsonArrayFrom`/`jsonObjectFrom`/`related()` projection now keeps its precision past `Number.MAX_SAFE_INTEGER`, exactly as its unwindowed form already did. The compiler's own cast decision and the query layer's own revive decision now read one shared vocabulary (every builder aggregate and window function, closed over the builder's own constructors) instead of two independently hand-kept lists that had drifted apart — a windowed `count()`/`row_number()`/`rank()`/`dense_rank()`/`min`/`max`/`lag`/`lead`/`firstValue`/`lastValue`/`nthValue` cell used to compile without the `::text` cast that carries a `bigint` through JSON transport losslessly.
