import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HejbroError } from "../../src/error";
import { createDefaultRegistry } from "../../src/kind/registry";
import {
	emptySnapshot,
	parseSnapshot,
	renderSnapshot,
	upgradeSnapshot,
} from "../../src/snapshot/snapshot";

const registry = createDefaultRegistry();
const FIXTURES_DIR = join(import.meta.dirname, "../fixtures/format-5");
const GOLDEN_DIR = join(import.meta.dirname, "../golden/cases");

const readFixture = (file: string): string =>
	readFileSync(join(FIXTURES_DIR, file), "utf8");

const readGoldenExpected = (caseName: string): string =>
	readFileSync(join(GOLDEN_DIR, caseName, "expected", "snapshot.json"), "utf8");

/** #413's oracle: the 0.1.1 release's own twelve format-5 snapshots (D Q1) — the two shipped examples plus every golden case that existed at that tag, vendored verbatim into `test/fixtures/format-5/`. */
const FORMAT_5_FIXTURES: ReadonlyArray<{
	readonly label: string;
	readonly file: string;
}> = [
	{ label: "example-postgres", file: "example-postgres.json" },
	{ label: "example-supabase", file: "example-supabase.json" },
	{ label: "golden-app-posts", file: "golden-app-posts.json" },
	{ label: "golden-app-security", file: "golden-app-security.json" },
	{ label: "golden-column-insert-mid", file: "golden-column-insert-mid.json" },
	{
		label: "golden-comments-single-depth",
		file: "golden-comments-single-depth.json",
	},
	{ label: "golden-grants-delta", file: "golden-grants-delta.json" },
	{ label: "golden-rls-policies", file: "golden-rls-policies.json" },
	{
		label: "golden-sequence-lifecycle",
		file: "golden-sequence-lifecycle.json",
	},
	{ label: "golden-table-constraints", file: "golden-table-constraints.json" },
	{ label: "golden-table-indexes", file: "golden-table-indexes.json" },
	{ label: "golden-view-lifecycle", file: "golden-view-lifecycle.json" },
];

/** Every golden case's current-format expected snapshot, plus the empty snapshot — the fixed-point table (T3): a diverse current-format input set (views, generated/identity columns, grants, sequences, offset/distinct) covering the shapes #413's re-encoding must leave untouched. */
const CURRENT_FORMAT_GOLDEN_CASES: ReadonlyArray<string> = [
	"app-posts",
	"app-security",
	"audit-posts",
	"column-insert-mid",
	"comments-single-depth",
	"computed-column-lifecycle",
	"grants-delta",
	"identity-column-lifecycle",
	"rls-policies",
	"sequence-lifecycle",
	"table-constraints",
	"table-index-methods",
	"table-indexes",
	"view-lifecycle",
];

const objectKeys = (raw: string): ReadonlySet<string> =>
	new Set(Object.keys((JSON.parse(raw) as { objects: object }).objects));

/** Runs `fn`, returning the `HejbroError` it throws — fails the test outright if it throws anything else or returns normally, so a mismatched assertion never silently passes. */
const captureHejbroError = (fn: () => unknown): HejbroError => {
	try {
		fn();
	} catch (error) {
		if (error instanceof HejbroError) {
			return error;
		}
		throw error;
	}
	throw new Error("expected a HejbroError to be thrown, but nothing was");
};

describe("upgradeSnapshot", () => {
	describe("re-encodes every format-5 snapshot the first release wrote", () => {
		it.each(FORMAT_5_FIXTURES)(
			"$label parses at format 8, keeps every object key and kind, and is idempotent",
			({ file }) => {
				const raw = readFixture(file);
				const originalKeys = objectKeys(raw);

				const once = upgradeSnapshot(raw, registry);
				expect(once.fromVersion).toBe(5);

				const parsed = parseSnapshot(once.text);
				expect(parsed.formatVersion).toBe(8);
				expect(new Set(Object.keys(parsed.objects))).toEqual(originalKeys);

				const twice = upgradeSnapshot(once.text, registry);
				expect(twice.text).toBe(once.text);
			},
		);
	});

	describe("the current format is a fixed point", () => {
		it.each(CURRENT_FORMAT_GOLDEN_CASES)(
			"%s: re-encoding today's own expected snapshot is byte-identical to the input",
			(caseName) => {
				const currentText = readGoldenExpected(caseName);

				const result = upgradeSnapshot(currentText, registry);

				expect(result.fromVersion).toBe(8);
				expect(result.text).toBe(currentText);
			},
		);

		it("the empty snapshot is byte-identical to the input", () => {
			const currentText = renderSnapshot(emptySnapshot);

			const result = upgradeSnapshot(currentText, registry);

			expect(result.fromVersion).toBe(8);
			expect(result.text).toBe(currentText);
		});
	});

	describe("formats outside the released range are refused exactly as the ordinary read refuses them", () => {
		it.each([
			[
				"a format-4 snapshot (older than any release)",
				JSON.stringify({ formatVersion: 4, dialect: "postgres", objects: {} }),
			],
			[
				"the pre-formatVersion key (older than any release)",
				JSON.stringify({ hejbroSnapshot: 3, dialect: "postgres", objects: {} }),
			],
			[
				"a format-9 snapshot (newer than this build)",
				JSON.stringify({ formatVersion: 9, dialect: "postgres", objects: {} }),
			],
			[
				"a non-numeric formatVersion",
				JSON.stringify({ formatVersion: "2", dialect: "postgres", objects: {} }),
			],
		])("%s", (_label, raw) => {
			const ordinary = captureHejbroError(() => parseSnapshot(raw));
			const upgrade = captureHejbroError(() => upgradeSnapshot(raw, registry));

			expect(upgrade.code).toBe(ordinary.code);
			expect(upgrade.message).toBe(ordinary.message);
		});
	});
});
