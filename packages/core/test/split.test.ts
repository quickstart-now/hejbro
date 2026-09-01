import { describe, expect, it } from "vitest";
import { defineFunction } from "../src/dsl/define-function";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { diffSnapshots } from "../src/engine/diff-engine";
import {
	emitStatementsSql,
	generateMigration,
	generateMigrations,
} from "../src/engine/generate";
import { applySplitChangesOnly, planSplit } from "../src/engine/split";
import { createDefaultRegistry } from "../src/kind/registry";
import { select } from "../src/query/select";
import { buildSnapshot, emptySnapshot } from "../src/snapshot/snapshot";
import { text, uuid } from "../src/types/column-builder-factories";

const app = schema("app");
const registry = createDefaultRegistry();

describe("planSplit / 4.1", () => {
	it("splits a run that adds an enum value and defaults a column to it", () => {
		const mood = pgEnum(app, "mood", ["ok"]);
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previous = buildSnapshot(
			[app, mood, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const moodV2 = pgEnum(app, "mood", ["ok", "great"]);
		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			flag: moodV2.column().default("great"),
		});
		const next = buildSnapshot(
			[app, moodV2, getTableMeta(t2)],
			registry,
			previous,
		);

		const changes = diffSnapshots(previous, next, registry);
		const decision = planSplit(changes);

		expect(decision.split).toBe(true);
		if (!decision.split) {
			throw new Error("expected a split decision");
		}
		expect(decision.enumChanges).toHaveLength(1);
		expect(decision.enumChanges[0]?.kind).toBe("enum");
		expect(decision.enumChanges[0]?.operation).toBe("alter");
		// The table's column-add change is the only other change here, so it
		// is exactly what's left once the enum change is pulled out.
		expect(decision.restChanges).toHaveLength(1);
		expect(decision.restChanges[0]?.kind).toBe("table");
	});

	it("does not split when the value is referenced only inside a function body", () => {
		const mood = pgEnum(app, "mood", ["ok"]);
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previous = buildSnapshot(
			[app, mood, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const moodV2 = pgEnum(app, "mood", ["ok", "great"]);
		// "great" appears only as plain text inside a raise message -- a
		// function's own snapshot stores its whole body as a rendered SQL
		// *string* (`FunctionSnapshot.bodySql`), never a `nodeKind`-bearing
		// node, so this can never be reached by the structural walk.
		const announce = defineFunction(
			app,
			"announce",
			{ args: {}, returns: t },
			(ctx) => {
				ctx.raise("the new mood value is great");
				ctx.return(select(t));
			},
		);
		const next = buildSnapshot(
			[app, moodV2, getTableMeta(t), announce],
			registry,
			previous,
		);

		const changes = diffSnapshots(previous, next, registry);
		const decision = planSplit(changes);

		expect(decision.split).toBe(false);
	});

	it("does not split when the enum type is created in the same run", () => {
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previous = buildSnapshot(
			[app, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const mood = pgEnum(app, "mood", ["ok", "great"]);
		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			flag: mood.column().default("great"),
		});
		const next = buildSnapshot(
			[app, mood, getTableMeta(t2)],
			registry,
			previous,
		);

		const changes = diffSnapshots(previous, next, registry);
		const decision = planSplit(changes);

		expect(decision.split).toBe(false);
	});

	it("splits on a matching spelling even when the literal is not the enum's value (over-approximation, by design)", () => {
		const mood = pgEnum(app, "mood", ["ok"]);
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previous = buildSnapshot(
			[app, mood, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const moodV2 = pgEnum(app, "mood", ["ok", "great"]);
		// `label` is an ordinary text column -- "great" here has nothing to
		// do with the enum, it just happens to read the same. The literal
		// carries no type/cast information (measured: an enum default
		// renders `default 'value'`, no `::type`), so this cannot be told
		// apart from a real reference without inferring every expression's
		// type -- declined on purpose (see split.ts's own [design] note).
		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			label: text().default("great"),
		});
		const next = buildSnapshot(
			[app, moodV2, getTableMeta(t2)],
			registry,
			previous,
		);

		const changes = diffSnapshots(previous, next, registry);
		const decision = planSplit(changes);

		expect(decision.split).toBe(true);
	});

	it("does not split when no run adds an enum value at all", () => {
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previous = buildSnapshot(
			[app, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			label: text(),
		});
		const next = buildSnapshot([app, getTableMeta(t2)], registry, previous);

		const changes = diffSnapshots(previous, next, registry);
		const decision = planSplit(changes);

		expect(decision.split).toBe(false);
	});
});

describe("applySplitChangesOnly / 4.2", () => {
	it("the first file's snapshot hash is the second file's parent hash", () => {
		const mood = pgEnum(app, "mood", ["ok"]);
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previous = buildSnapshot(
			[app, mood, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const moodV2 = pgEnum(app, "mood", ["ok", "great"]);
		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			flag: moodV2.column().default("great"),
		});
		const next = buildSnapshot(
			[app, moodV2, getTableMeta(t2)],
			registry,
			previous,
		);

		const changes = diffSnapshots(previous, next, registry);
		const decision = planSplit(changes);
		if (!decision.split) {
			throw new Error("expected a split decision");
		}

		const intermediate = applySplitChangesOnly(previous, decision.enumChanges);

		// The enum's own entry in the intermediate snapshot already carries
		// the added value ...
		expect(intermediate.objects["enum:app.mood"]).toEqual(
			next.objects["enum:app.mood"],
		);
		// ... and nothing else moved: the table entry is still the OLD one,
		// not the one carrying the new column.
		expect(intermediate.objects["table:app.t"]).toEqual(
			previous.objects["table:app.t"],
		);
	});
});

describe("split reconstruction / 4.3", () => {
	// "Banners chain" and byte-identical *final SQL bytes* are pinned at
	// the CLI level (`generate-split.test.ts`) -- real sha256 hashing is
	// CLI-owned (core never hashes; no core test anywhere passes a real
	// `bannerHashes` value, confirmed by reading the existing suite before
	// writing this one). What's genuinely core's own property is that the
	// two halves, applied in order, reconstruct the identical *snapshot*
	// an unsplit run would have produced -- proved here without any
	// hashing at all.
	it("applying both halves in order reconstructs the same final snapshot an unsplit run produces", () => {
		const mood = pgEnum(app, "mood", ["ok"]);
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previous = buildSnapshot(
			[app, mood, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const moodV2 = pgEnum(app, "mood", ["ok", "great"]);
		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			flag: moodV2.column().default("great"),
		});
		const next = buildSnapshot(
			[app, moodV2, getTableMeta(t2)],
			registry,
			previous,
		);

		const changes = diffSnapshots(previous, next, registry);
		const decision = planSplit(changes);
		if (!decision.split) {
			throw new Error("expected a split decision");
		}

		const afterFirstHalf = applySplitChangesOnly(
			previous,
			decision.enumChanges,
		);
		const afterSecondHalf = applySplitChangesOnly(
			afterFirstHalf,
			decision.restChanges,
		);

		expect(afterSecondHalf).toEqual(next);
	});

	// The most plausible failure in this design (approved architecture:
	// both halves' `emit()` calls see the *whole* run's `changes` as
	// siblingChanges and the *whole* run's final snapshot as context,
	// unchanged from what an unsplit run would pass) is the same
	// statement being emitted on both sides of the split -- a kind whose
	// `emit` reacts to a sibling it can now see once per half, deciding
	// twice to render something. The final-snapshot-bytes invariant above
	// cannot catch this: it looks at the snapshot, never at the SQL text.
	it("the union of both halves' emitted statements matches an unsplit run's, in order, with no duplicates or omissions", () => {
		const mood = pgEnum(app, "mood", ["ok"]);
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previous = buildSnapshot(
			[app, mood, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const moodV2 = pgEnum(app, "mood", ["ok", "great"]);
		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			flag: moodV2.column().default("great"),
		});
		const next = buildSnapshot(
			[app, moodV2, getTableMeta(t2)],
			registry,
			previous,
		);

		const changes = diffSnapshots(previous, next, registry);
		const decision = planSplit(changes);
		if (!decision.split) {
			throw new Error("expected a split decision");
		}

		const unsplitSql = emitStatementsSql(changes, changes, next, registry);
		const firstSql = emitStatementsSql(
			decision.enumChanges,
			changes,
			next,
			registry,
		);
		const secondSql = emitStatementsSql(
			decision.restChanges,
			changes,
			next,
			registry,
		);
		const combinedParts = [firstSql, secondSql].filter((part) => part !== "");

		expect(combinedParts.join("\n\n")).toBe(unsplitSql);
	});
});

describe("generateMigrations / G4 rework (#610)", () => {
	it("returns one migration per transaction boundary the run needs", () => {
		const mood = pgEnum(app, "mood", ["ok"]);
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previousSnapshot = buildSnapshot(
			[app, mood, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const moodV2 = pgEnum(app, "mood", ["ok", "great"]);
		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			flag: moodV2.column().default("great"),
		});

		const result = generateMigrations({
			declarations: [app, moodV2, getTableMeta(t2)],
			previousSnapshot,
			registry,
		});

		expect(result.hasChanges).toBe(true);
		expect(result.migrations).toHaveLength(2);
		expect(result.migrations[0]?.changes.map((c) => c.kind)).toEqual(["enum"]);
		expect(result.migrations[0]?.sql).toContain("alter type");
		expect(result.migrations[1]?.changes.map((c) => c.kind)).toEqual(["table"]);
		expect(result.migrations[1]?.sql).toContain("alter table");
		// The second (final) file's own snapshot is what an unsplit run of
		// the identical declarations would have arrived at too -- splitting
		// the *file* never changes the *declared* end state. This run can't
		// be diffed against `generateMigration`'s own output for the same
		// declarations, because that entry point refuses exactly this run
		// (proved separately below) -- so the expected end state is built
		// directly instead, the same way `buildSnapshot` is used everywhere
		// else in this file.
		const expectedFinalSnapshot = buildSnapshot(
			[app, moodV2, getTableMeta(t2)],
			registry,
			previousSnapshot,
		);
		expect(result.migrations[1]?.snapshot).toEqual(expectedFinalSnapshot);
	});

	it("returns one migration, unchanged, for an ordinary run", () => {
		const mood = pgEnum(app, "mood", ["ok"]);
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previousSnapshot = buildSnapshot(
			[app, mood, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			label: text(),
		});

		const result = generateMigrations({
			declarations: [app, mood, getTableMeta(t2)],
			previousSnapshot,
			registry,
		});

		expect(result.migrations).toHaveLength(1);
	});
});

describe("generateMigration / G4 rework (#610)", () => {
	it("refuses a run that needs a transaction boundary, naming generateMigrations as the next step", () => {
		const mood = pgEnum(app, "mood", ["ok"]);
		const t = table(app, "t", { id: uuid().primaryKey() });
		const previousSnapshot = buildSnapshot(
			[app, mood, getTableMeta(t)],
			registry,
			emptySnapshot,
		);

		const moodV2 = pgEnum(app, "mood", ["ok", "great"]);
		const t2 = table(app, "t", {
			id: uuid().primaryKey(),
			flag: moodV2.column().default("great"),
		});

		try {
			generateMigration({
				declarations: [app, moodV2, getTableMeta(t2)],
				previousSnapshot,
				registry,
			});
			throw new Error("expected generateMigration to throw");
		} catch (error) {
			expect((error as { code?: string }).code).toBe(
				"migration-requires-split",
			);
			expect((error as Error).message).toContain("generateMigrations");
			expect((error as Error).message).toMatch(/Next:/);
		}
	});
});
