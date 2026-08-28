---
"@hejbro/core": minor
---

Column-level foreign keys: `.references(() => users.id)` declares the same foreign key the `extras` path does — one declaration feeds the DDL and the type layer (the query layer's relation derivation reads the edge). Self-referencing and composite foreign keys, and `onDelete`/`onUpdate` actions, stay on `extras`; declaring both over one column fails loudly.
