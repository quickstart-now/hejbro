---
"@hejbro/core": minor
---

The column-level `.references()` sugar now takes an optional second
argument carrying the foreign key's referential actions:
`ownerId: uuid().notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" })`.
Both `onDelete` and `onUpdate` are optional and accept the same five
values the `extras.foreignKeys` form already does. The generated DDL,
snapshot, and diff are byte-identical to the equivalent `extras`
declaration, including for a change to just the action (a drop and
re-add of the constraint) and for a rename of the referenced table.
Self-referencing and composite (multi-column) foreign keys are
unaffected and stay on the `extras.foreignKeys` form. Calling
`.references()` more than once on the same column replaces the
reference as a whole -- the last call's target and the last call's
actions, with no action from an earlier call left over.
