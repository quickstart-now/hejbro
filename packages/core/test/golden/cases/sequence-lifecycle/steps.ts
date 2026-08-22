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
// next step can drop just the serial *column* while the table survives,
// exercising the OWNED BY cascade at the column level specifically (#193
// review: reviewer's own predicted scenario -- table drop and column drop
// are the same defect class, but table drop alone doesn't prove column
// drop is covered too).

const reAddedSerial: ReadonlyArray<HejbroInput> = [app, addedSerial];

// Step 5: drop just the "id" column (table survives, "title" remains).
// Postgres's `owned by` link cascades the sequence away the moment the
// *column* is dropped, not just the table -- confirmed directly against a
// real Postgres (see the commit message for the exact repro). Proves
// generate.ts's cascade suppression triggers on a column drop too, not
// only a whole-table drop.

const onlyTitle = table(app, "posts", { title: text() });

const droppedSerialColumn: ReadonlyArray<HejbroInput> = [app, onlyTitle];

// Step 6: integer() -> serial() a third time -- re-introduce the sequence
// once more so the next step drops a table that still has a live serial
// column, exercising the OWNED BY cascade at the table level (self-check
// requested by planner: does dropping the whole table double-drop the
// sequence, or error on a sequence Postgres already cascaded away?).
//
// Deliberately *not* `.primaryKey()` here (#137/#202 review): step 5
// dropped "id" entirely, so re-adding it is a genuine `columnDiff.added`
// column, not a type-alter on a survivor -- and #202's pk-guard correctly
// refuses adding a `.primaryKey()` column to an existing table (the real
// defect it closes: hejbro used to silently emit the column without its
// constraint). This step's own purpose is only "a live serial column for
// step 7 to drop", which a bare `serial()` already provides in full
// (still not-null, via materializeNotNull's serial-implies-notNull rule,
// independent of primary-key status) -- no `.primaryKey()` needed for
// that. #24/phase8-constraint-names is what will let a step exercise
// *adding* a primary-key column to an existing table for real; until
// then, this golden case isn't the place to reach that guard.

const reReAddedSerial: ReadonlyArray<HejbroInput> = [
	app,
	table(app, "posts", { id: serial(), title: text() }),
];

// Step 7: drop the whole table -- posts (and its serial column, and its
// `posts_id_seq` sequence) is gone entirely. Postgres's own `owned by`
// link means `drop table` alone already cascades the sequence drop; this
// step proves generate.ts suppresses sequenceKind's own drop statements
// rather than emitting SQL against a target the cascade already removed.

const droppedTable: ReadonlyArray<HejbroInput> = [app];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	integerToSerial,
	serialToBigserial,
	removedSerial,
	reAddedSerial,
	droppedSerialColumn,
	reReAddedSerial,
	droppedTable,
];
