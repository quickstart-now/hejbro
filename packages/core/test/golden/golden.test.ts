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
import type { HejbroInput, Snapshot } from "../../src/index";
import {
	emptySnapshot,
	generateMigration,
	renderSnapshot,
} from "../../src/index";

// The case modules under test/golden/cases are loaded via a runtime-built
// path (join(...)), so TypeScript can't statically resolve their exports —
// this describes the one shape every case's steps.ts must satisfy.
type StepsModule = {
	readonly steps: ReadonlyArray<ReadonlyArray<HejbroInput>>;
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
					declarations: ReadonlyArray<HejbroInput>,
					stepIndex: number,
				) => {
					const generated = generateMigration({
						declarations,
						previousSnapshot: state.snapshot,
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
		const [initialDeclarations] = steps;
		if (initialDeclarations === undefined) {
			throw new Error("expected the app-posts case to have at least one step");
		}
		const runOnce = () =>
			generateMigration({
				declarations: initialDeclarations,
				previousSnapshot: emptySnapshot,
			});
		expect(renderSnapshot(runOnce().snapshot)).toBe(
			renderSnapshot(runOnce().snapshot),
		);
		expect(runOnce().sql).toBe(runOnce().sql);
	});
});
