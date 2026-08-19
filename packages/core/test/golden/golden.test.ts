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
import type { HejbroDeclaration, Snapshot } from "../../src/index";
import {
	emptySnapshot,
	generateMigration,
	renderSnapshot,
} from "../../src/index";

// The case modules under test/golden/cases are loaded via a runtime-built
// path (join(...)), so TypeScript can't statically resolve their exports —
// this describes the one shape every case's steps.ts must satisfy.
type StepsModule = {
	readonly steps: ReadonlyArray<ReadonlyArray<HejbroDeclaration>>;
};

const stepLabel = (index: number): string => {
	if (index === 0) return "from-empty";
	return `step-${index}`;
};

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
					declarations: ReadonlyArray<HejbroDeclaration>,
					stepIndex: number,
				) => {
					const generated = generateMigration({
						declarations,
						previousSnapshot: state.snapshot,
					});
					const label = stepLabel(stepIndex);
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
			join(casesDirectory, "ddland-posts", "steps.ts")
		);
		const [initialDeclarations] = steps;
		if (initialDeclarations === undefined) {
			throw new Error(
				"expected the ddland-posts case to have at least one step",
			);
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
