import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainEntry, ConfirmDropSpec } from "hejbro";
import {
	checkChain,
	emptySnapshot,
	generateMigration,
	parseBannerHashes,
	renderSnapshot,
} from "hejbro";
import { describe, expect, it } from "vitest";
import { declarations as step1 } from "../src/steps/step-1.schema";
import { declarations as step2 } from "../src/steps/step-2.schema";
import { declarations as step3 } from "../src/steps/step-3.schema";
import { declarations as step4 } from "../src/steps/step-4.schema";
import { declarations as step5 } from "../src/steps/step-5.schema";
import { declarations as step6 } from "../src/steps/step-6.schema";
import { declarations as step7 } from "../src/steps/step-7.schema";
import { declarations as step8 } from "../src/steps/step-8.schema";
import { declarations as step9 } from "../src/steps/step-9.schema";

const root = join(import.meta.dirname, "..");
const migrationFiles = readdirSync(join(root, "migrations"))
	.filter((f) => f.endsWith(".sql"))
	.sort();
// Deliberately drops every banner line (the `-- hejbro migration` header,
// each `+`/`~`/`-` change line, and the parent-snapshot/snapshot hash
// pair) before comparing -- this test's job is to confirm regenerating
// from the step declarations reproduces the committed *SQL statements*,
// not the banner text that summarizes them. Banner correctness for a
// preset (non-core) kind is the preset's own responsibility: e.g. the
// storage bucket kind's create/alter/drop banners are pinned directly in
// `packages/supabase/test/storage-bucket-kind.test.ts`, full-string, not
// here. That's a division of labor, not a gap -- this example-layer test
// would never catch a banner regression like #116's on its own, and
// isn't meant to.
const stripBanner = (sql: string): string =>
	sql
		.split("\n")
		.filter((line) => !line.startsWith("-- "))
		.join("\n");
// Step 4 moves due_at across tables — the same --confirm-drop the CLI asked for in Task 16.
const confirmedDropsForStep = (
	stepIndex: number,
): ReadonlyArray<ConfirmDropSpec> => {
	if (stepIndex !== 3) {
		return [];
	}
	return [
		{
			target: "column",
			schemaName: "app",
			tableName: "tasks",
			columnName: "due_at",
		},
	];
};

describe("examples/postgres migration chain", () => {
	it("regenerating from the step declarations reproduces the committed migrations", () => {
		const steps = [
			step1,
			step2,
			step3,
			step4,
			step5,
			step6,
			step7,
			step8,
			step9,
		];
		const outcome = steps.reduce(
			(state, declarations, i) => {
				const result = generateMigration({
					declarations,
					previousSnapshot: state.snapshot,
					confirmedDrops: confirmedDropsForStep(i),
				});
				expect(result.errors).toEqual([]);
				const committed = readFileSync(
					join(root, "migrations", migrationFiles[i] as string),
					"utf8",
				);
				// The CLI appends a trailing newline when it writes a migration
				// file (`${sql}\n`, packages/cli/src/commands/generate.ts); an
				// in-process `result.sql` never has one — trim both before
				// comparing.
				expect(stripBanner(result.sql).trimEnd()).toBe(
					stripBanner(committed).trimEnd(),
				);
				return { snapshot: result.snapshot };
			},
			{ snapshot: emptySnapshot },
		);
		expect(renderSnapshot(outcome.snapshot)).toBe(
			readFileSync(join(root, "hejbro.snapshot.json"), "utf8"),
		);
	});

	it("the committed banners form an unbroken hash chain", () => {
		const entries: ReadonlyArray<ChainEntry> = migrationFiles.map((name) => {
			const hashes = parseBannerHashes(
				readFileSync(join(root, "migrations", name), "utf8"),
			);
			if (hashes === null) {
				throw new Error(`${name} has no banner hash lines`);
			}
			return { fileName: name, parent: hashes.parent, current: hashes.current };
		});
		const report = checkChain(entries);
		expect(report.ok).toBe(true);
	});
});
