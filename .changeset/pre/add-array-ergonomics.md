---
"@hejbro/core": minor
---

Array ergonomics: declare non-null array elements with a constraint that backs the claim — `.array().notNullElements()` emits a `CHECK` named `<column>_no_null_elements` and narrows the element type from `T | null` to `T` on read and write — and narrow nullable-element arrays at runtime with the new `assertNoNulls`, which throws naming the first null index and never filters.
