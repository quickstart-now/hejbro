import type { HejbroInput } from "../../../../src/index";
import { bigserial, integer, serial, table, text } from "../../../../src/index";
import { app } from "./declarations";

// Step 0: a plain integer column -- no sequence yet. Baseline the rest of
// the chain transitions from and back to.

const plainInteger = table(app, "posts", {
	id: integer().primaryKey(),
	title: text(),
});

const fromEmpty: ReadonlyArray<HejbroInput> = [app, plainInteger];

// Step 1: integer() -> serial() -- #23/D66's first recorded defect
// (`alter column … type serial` is invalid Postgres; closed structurally,
// not by a guard, since a ColumnSnapshot never stores the pseudo-type
// past serialize time). Proves: create sequence, owned-by, set-default,
// no `type serial` anywhere in the emitted SQL.

const addedSerial = table(app, "posts", {
	id: serial().primaryKey(),
	title: text(),
});

const integerToSerial: ReadonlyArray<HejbroInput> = [app, addedSerial];

// Step 2: serial() -> bigserial() -- a same-sequence family change. Proves
// the sequence keeps its identity (`posts_id_seq`, not dropped and
// recreated) and only its `as` clause and the column's own type change.

const widenedToBigserial = table(app, "posts", {
	id: bigserial().primaryKey(),
	title: text(),
});

const serialToBigserial: ReadonlyArray<HejbroInput> = [app, widenedToBigserial];

// Step 3: bigserial() -> integer() -- #23/D66's second recorded defect
// (silently omitted `drop default` and sequence drop). Proves: drop
// default, then drop sequence, column stays a plain not-null integer.

const removedSerial: ReadonlyArray<HejbroInput> = [app, plainInteger];

// Step 4: integer() -> serial() again -- re-introduce the sequence so the
// next step drops a table that still has a live serial column, exercising
// the OWNED BY cascade scenario specifically (self-check requested by
// planner: does dropping the whole table double-drop the sequence, or
// error on a sequence Postgres already cascaded away?).

const reAddedSerial: ReadonlyArray<HejbroInput> = [app, addedSerial];

// Step 5: drop the whole table -- posts (and its serial column, and its
// `posts_id_seq` sequence) is gone entirely. Postgres's own `owned by`
// link means `drop table` alone already cascades the sequence drop; this
// step proves sequenceKind's own (independent, idempotent) drop statements
// don't then error on a target the cascade already removed.

const droppedTable: ReadonlyArray<HejbroInput> = [app];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	integerToSerial,
	serialToBigserial,
	removedSerial,
	reAddedSerial,
	droppedTable,
];
