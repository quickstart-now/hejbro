// test/golden/golden.test.ts  (fs allowed HERE — this is the test layer)
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HejbroInput, RenameSpec, Snapshot } from "../../src/index";
import {
	emptySnapshot,
	generateMigration,
	renderSnapshot,
} from "../../src/index";

// The case modules under test/golden/cases are loaded via a runtime-built
// path (join(...)), so TypeScript can't statically resolve their exports —
// this describes the one shape every case's steps.ts must satisfy. A step
// is either a bare declarations array (the common case, every case but
// #284's `table-index-methods`) or `{ declarations, renames }` when the
// step also exercises `--rename` (US3/T035 — a column rename retargeting
// an index expression, which needs `generateMigration`'s own `renames`
// resolution, not just a declaration-set diff).
type StepEntry =
	| ReadonlyArray<HejbroInput>
	| {
			readonly declarations: ReadonlyArray<HejbroInput>;
			readonly renames?: ReadonlyArray<RenameSpec>;
	  };

type StepsModule = {
	readonly steps: ReadonlyArray<StepEntry>;
};

/** Normalizes a `StepEntry` to its `declarations`/`renames` pair — a bare array has no renames. */
const normalizeStep = (
	entry: StepEntry,
): {
	readonly declarations: ReadonlyArray<HejbroInput>;
	readonly renames: ReadonlyArray<RenameSpec>;
} => {
	if ("declarations" in entry) {
		return { declarations: entry.declarations, renames: entry.renames ?? [] };
	}
	return { declarations: entry, renames: [] };
};

const stepLabel = (index: number): string => {
	if (index === 0) return "from-empty";
	return `step-${index}`;
};

// Every step in every case is declared because it changes something; a
// step whose generated SQL is nothing but the `-- hejbro migration` banner
// (or is empty outright) means the step stopped testing anything -- most
// often because two declarations that were supposed to differ came to read
// the same. `UPDATE_GOLDEN=1` happily rewrites `expected/*.sql` to match
// whatever gets generated, including an empty file, so this can't be an
// `expect(generated.sql).toBe(readOrRecord(...))` check: that comparison
// is satisfied by construction the moment the file is (re)written. This
// runs against `generated.sql` directly, independent of UPDATE_GOLDEN, so
// a no-op step fails here even immediately after a regen.
//
// "Changes something" and "emits a SQL statement" aren't the same thing,
// though: D42 has the storage bucket kind's `drop` emit no SQL at all (a
// banner-only migration, on purpose -- auto-deleting a bucket would
// destroy user files), and `storage-bucket-kind.test.ts` pins exactly that
// as a real, intended migration. None of today's 8 core golden cases use
// a preset kind, so this guard has never had to distinguish the two. If a
// golden case is ever added that reaches a legitimately banner-only step
// (a preset drop, most likely), the fix is a documented, case-specific
// opt-out for that one step -- not deleting or loosening this guard,
// which would drop the no-op protection for all 8 (soon more) existing
// cases along with it.

const hasStatementBeyondBanner = (sql: string): boolean =>
	sql
		.split("\n")
		.some((line) => line.trim() !== "" && !line.trimStart().startsWith("--"));

const casesDirectory = join(import.meta.dirname, "cases");
const shouldUpdate = process.env.UPDATE_GOLDEN === "1";

const readOrRecord = (filePath: string, actual: string) => {
	if (shouldUpdate) {
		mkdirSync(join(filePath, ".."), { recursive: true });
		writeFileSync(filePath, actual);
	}
	if (!existsSync(filePath)) {
		throw new Error(
			`missing golden file ${filePath} — run UPDATE_GOLDEN=1 pnpm test, then review the diff`,
		);
	}
	return readFileSync(filePath, "utf8");
};

describe("golden cases", () => {
	const caseNames = readdirSync(casesDirectory);
	caseNames.map((caseName) =>
		it(`${caseName}: from empty and per step`, async () => {
			const caseDirectory = join(casesDirectory, caseName);
			const { steps }: StepsModule = await import(
				join(caseDirectory, "steps.ts")
			);
			const outcome = steps.reduce(
				(
					state: { readonly snapshot: Snapshot },
					entry: StepEntry,
					stepIndex: number,
				) => {
					const { declarations, renames } = normalizeStep(entry);
					const generated = generateMigration({
						declarations,
						previousSnapshot: state.snapshot,
						renames,
					});
					const label = stepLabel(stepIndex);
					expect(
						hasStatementBeyondBanner(generated.sql),
						`${caseName} ${label}: generated SQL has no statement beyond the banner comments -- this step is a no-op (see hasStatementBeyondBanner's comment)`,
					).toBe(true);
					expect(generated.sql).toBe(
						readOrRecord(
							join(caseDirectory, "expected", `${label}.sql`),
							generated.sql,
						),
					);
					return { snapshot: generated.snapshot };
				},
				{ snapshot: emptySnapshot },
			);
			const rendered = renderSnapshot(outcome.snapshot);
			expect(rendered).toBe(
				readOrRecord(
					join(caseDirectory, "expected", "snapshot.json"),
					rendered,
				),
			);
		}),
	);
});

describe("determinism", () => {
	it("two runs produce byte-identical snapshot and sql", async () => {
		const { steps }: StepsModule = await import(
			join(casesDirectory, "app-posts", "steps.ts")
		);
		const [firstEntry] = steps;
		if (firstEntry === undefined) {
			throw new Error("expected the app-posts case to have at least one step");
		}
		const { declarations, renames } = normalizeStep(firstEntry);
		const runOnce = () =>
			generateMigration({
				declarations,
				previousSnapshot: emptySnapshot,
				renames,
			});
		expect(renderSnapshot(runOnce().snapshot)).toBe(
			renderSnapshot(runOnce().snapshot),
		);
		expect(runOnce().sql).toBe(runOnce().sql);
	});
});
