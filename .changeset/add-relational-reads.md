---
"@hejbro/core": minor
---

Column-level foreign keys: `.references(() => users.id)` declares the same foreign key the `extras` path does — one declaration feeds the DDL and the type layer (the query layer's relation derivation reads the edge). Self-referencing and composite foreign keys, and `onDelete`/`onUpdate` actions, stay on `extras`; declaring both over one column fails loudly. Snapshot format version bumps to 7: foreign keys are recorded in canonical, declaration-form-independent order (v6 was never released). The nested-read base layer lands too: `jsonArrayFrom(subselect)`/`jsonObjectFrom(subselect)` compile to visible correlated subqueries (`compile()` shows every cast), with `bigint`/`numeric` values text-cast so precision survives the JSON round trip.
