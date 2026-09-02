import { describe, expect, it } from "vitest";
// #445/R5 review R-e: imported separately from core's own public index, not
// just "../src/sql/migration-file" like every other symbol below -- the
// delta's own requirement is that this parser is exposed PUBLICLY, and
// nothing here proves that without importing it the same way a consumer
// would.
import { parseBannerBaseline as parseBannerBaselineFromIndex } from "../src/index";
import type { KindChange } from "../src/kind/object-kind";
import type { Snapshot } from "../src/snapshot/snapshot";
import type { JsonValue } from "../src/snapshot/stable-json";
import {
	deriveExistingTransitionSlug,
	deriveSlug,
	findDuplicateVersionGroups,
	migrationFileName,
	migrationVersionOf,
	parseBannerBaseline,
	parseBannerHashes,
	parseBannerVersion,
	renderBanner,
	renderMigrationPrefix,
} from "../src/sql/migration-file";

const fixedDate = new Date(Date.UTC(2026, 7, 19, 14, 30, 52));

describe("migrationFileName", () => {
	it("renders a UTC timestamp prefix", () => {
		expect(
			migrationFileName({
				strategy: "timestamp",
				generatedAt: fixedDate,
				previousCount: 0,
				slug: "add_profiles",
			}),
		).toBe("20260819143052_add_profiles.sql");
	});

	it("renders a zero-padded index prefix", () => {
		expect(
			migrationFileName({
				strategy: "index",
				generatedAt: fixedDate,
				previousCount: 6,
				slug: "add_profiles",
			}),
		).toBe("0007_add_profiles.sql");
	});

	it("renders a unix timestamp prefix", () => {
		expect(
			migrationFileName({
				strategy: "unix",
				generatedAt: fixedDate,
				previousCount: 0,
				slug: "add_profiles",
			}),
		).toBe(`${Math.floor(fixedDate.getTime() / 1000)}_add_profiles.sql`);
	});
});

const createChange: KindChange = {
	kind: "table",
	operation: "create",
	identity: "app.posts",
	previous: null,
	next: {},
	notes: [],
};
const alterChange: KindChange = {
	kind: "table",
	operation: "alter",
	identity: "app.posts",
	previous: {},
	next: {},
	notes: ['column "slug" added'],
};
const dropChange: KindChange = {
	kind: "view",
	operation: "drop",
	identity: "app.old",
	previous: {},
	next: null,
	notes: [],
};

describe("renderBanner", () => {
	it("renders create/alter/drop markers with alter notes bracketed", () => {
		expect(renderBanner([createChange, alterChange, dropChange])).toBe(
			'-- hejbro migration\n-- + table app.posts [new]\n-- ~ table app.posts [column "slug" added]\n-- - view app.old [dropped]',
		);
	});

	it("marks a baseline directly under the version line (#385)", () => {
		expect(renderBanner([createChange], undefined, "0.2.0", true)).toBe(
			"-- hejbro migration\n-- hejbro: 0.2.0\n-- baseline: these objects already exist — register this migration as applied, do not run it\n-- + table app.posts [new]",
		);
	});

	it("omits the baseline line for an ordinary migration", () => {
		expect(
			renderBanner([createChange], undefined, "0.2.0", false),
		).not.toContain("-- baseline:");
		expect(renderBanner([createChange], undefined, "0.2.0")).not.toContain(
			"-- baseline:",
		);
	});

	it("renders a drop's notes in its banner label, alongside the dropped marker, when present", () => {
		const dropWithNotes: KindChange = {
			kind: "supabase-storage-bucket",
			operation: "drop",
			identity: "avatars",
			previous: {},
			next: null,
			notes: [
				'bucket "avatars" removed from declarations — remove it manually in Supabase when ready.',
			],
		};
		expect(renderBanner([dropWithNotes])).toBe(
			'-- hejbro migration\n-- - supabase-storage-bucket avatars [dropped: bucket "avatars" removed from declarations — remove it manually in Supabase when ready.]',
		);
	});

	it("joins multiple drop notes the same way alter does (comma-separated)", () => {
		const dropWithNotes: KindChange = {
			kind: "table",
			operation: "drop",
			identity: "app.posts",
			previous: {},
			next: null,
			notes: ["note one", "note two"],
		};
		expect(renderBanner([dropWithNotes])).toBe(
			"-- hejbro migration\n-- - table app.posts [dropped: note one, note two]",
		);
	});

	it("renders a same-identity recreate (single alter change) with its recreating note", () => {
		const recreateChange: KindChange = {
			kind: "trigger",
			operation: "alter",
			identity: "app.comments.guard",
			previous: {},
			next: {},
			notes: ["trigger changed; recreating"],
		};
		expect(renderBanner([recreateChange])).toBe(
			"-- hejbro migration\n-- ~ trigger app.comments.guard [trigger changed; recreating]",
		);
	});

	it("omits the bracket entirely for an alter with no notes (#116 -- no kind should ever render a bare [])", () => {
		const alterWithoutNotes: KindChange = {
			kind: "supabase-storage-bucket",
			operation: "alter",
			identity: "attachments",
			previous: {},
			next: {},
			notes: [],
		};
		expect(renderBanner([alterWithoutNotes])).toBe(
			"-- hejbro migration\n-- ~ supabase-storage-bucket attachments",
		);
	});

	it("appends parent-snapshot/snapshot hash lines when hashes are given (Phase 5)", () => {
		expect(
			renderBanner([createChange], {
				parent: "sha256:aaaa",
				current: "sha256:bbbb",
			}),
		).toBe(
			"-- hejbro migration\n-- + table app.posts [new]\n-- parent-snapshot: sha256:aaaa\n-- snapshot: sha256:bbbb",
		);
	});

	it("omits the hash lines when no hashes are given", () => {
		expect(renderBanner([createChange])).not.toContain("parent-snapshot");
	});

	it("inserts the -- hejbro: <version> line directly below -- hejbro migration when version is given (#229)", () => {
		expect(renderBanner([createChange], undefined, "0.1.0")).toBe(
			"-- hejbro migration\n-- hejbro: 0.1.0\n-- + table app.posts [new]",
		);
	});

	it("places the version line above the hash-chain lines when both are given", () => {
		expect(
			renderBanner(
				[createChange],
				{ parent: "sha256:aaaa", current: "sha256:bbbb" },
				"0.1.0",
			),
		).toBe(
			"-- hejbro migration\n-- hejbro: 0.1.0\n-- + table app.posts [new]\n-- parent-snapshot: sha256:aaaa\n-- snapshot: sha256:bbbb",
		);
	});

	it("omits the version line when no version is given", () => {
		expect(renderBanner([createChange])).not.toContain("-- hejbro:");
	});
});

describe("parseBannerHashes", () => {
	it("round-trips a banner rendered with hashes", () => {
		const sql = renderBanner([createChange], {
			parent: "sha256:aaaa",
			current: "sha256:bbbb",
		});
		expect(parseBannerHashes(sql)).toEqual({
			parent: "sha256:aaaa",
			current: "sha256:bbbb",
		});
	});

	it("returns null for a hash-less banner", () => {
		expect(parseBannerHashes(renderBanner([createChange]))).toBeNull();
	});

	it("still parses hashes when a version line sits between the banner lines and the hash lines (#229 unknown-line tolerance)", () => {
		const sql = renderBanner(
			[createChange],
			{ parent: "sha256:aaaa", current: "sha256:bbbb" },
			"0.1.0",
		);
		expect(parseBannerHashes(sql)).toEqual({
			parent: "sha256:aaaa",
			current: "sha256:bbbb",
		});
	});
});

describe("parseBannerVersion", () => {
	it("round-trips a banner rendered with a version", () => {
		const sql = renderBanner([createChange], undefined, "0.1.0");
		expect(parseBannerVersion(sql)).toBe("0.1.0");
	});

	it("returns null for a version-less banner (every pre-#229 migration file)", () => {
		expect(parseBannerVersion(renderBanner([createChange]))).toBeNull();
	});
});

describe("parseBannerBaseline (#445/R5)", () => {
	it("reads the baseline marker back off a rendered banner, and reports its absence on an ordinary migration", () => {
		const baselineSql = renderBanner(
			[createChange],
			undefined,
			undefined,
			true,
		);
		const ordinarySql = renderBanner([createChange]);
		expect(parseBannerBaseline(baselineSql)).toBe(true);
		expect(parseBannerBaseline(ordinarySql)).toBe(false);
	});

	it("stays true even with a version line and a hash chain also present, and false for a hash-chained non-baseline migration", () => {
		const baselineSql = renderBanner(
			[createChange],
			{ parent: "sha256:aaaa", current: "sha256:bbbb" },
			"0.1.0",
			true,
		);
		const nonBaselineSql = renderBanner(
			[createChange],
			{ parent: "sha256:aaaa", current: "sha256:bbbb" },
			"0.1.0",
		);
		expect(parseBannerBaseline(baselineSql)).toBe(true);
		expect(parseBannerBaseline(nonBaselineSql)).toBe(false);
	});

	it("is exported from core's own public index, not just its defining module (#445/R5 review R-e)", () => {
		const baselineSql = renderBanner(
			[createChange],
			undefined,
			undefined,
			true,
		);
		expect(parseBannerBaselineFromIndex(baselineSql)).toBe(true);
		expect(parseBannerBaselineFromIndex).toBe(parseBannerBaseline);
	});

	it("ignores an unrelated banner line that happens to contain the word 'baseline'", () => {
		// a `false` guard: parsing must key on the exact known prefix, not a
		// loose substring match that an unrelated line could accidentally
		// trip (e.g. a future kind's own note text).
		const sql = "-- hejbro migration\n-- ~ table app.posts [baseline notes]";
		expect(parseBannerBaseline(sql)).toBe(false);
	});

	it("still reports true for a differently-worded baseline line -- the prefix is the contract, not the guidance prose", () => {
		// simulates an already-written migration whose prose predates a
		// future wording change: matching the whole rendered sentence
		// (instead of just the "-- baseline:" prefix) would silently
		// report `false` here, telling an apply tool to RUN a migration
		// that must only ever be registered.
		const sql =
			"-- hejbro migration\n-- baseline: an earlier wording of this same guidance\n-- + table app.posts [new]";
		expect(parseBannerBaseline(sql)).toBe(true);
	});
});

/**
 * Forward compatibility (R2-G4, 4.11): a banner line no current parser
 * recognizes at all -- distinct from the coverage `parseBannerHashes`'s
 * own "#229 unknown-line tolerance" test carries, which only proves that
 * *other known* prefixes (the version line) don't confuse a parser
 * reading its own. This restores the guard 2.10 removed along with
 * `parseBannerManifestFormat` (the manifest banner line was this test's
 * only "genuinely unknown to everyone" fixture) -- the property itself
 * survives the manifest capability's own withdrawal and is required by
 * the shipped `migration-format` spec ("an unrecognized banner line is
 * ignored").
 */
describe("an unrecognized banner line does not break the parsers that read the others", () => {
	it("every current parser still reads its own line with a fabricated, nobody-recognizes-it line mixed in", () => {
		const rendered = renderBanner(
			[createChange],
			{ parent: "sha256:aaaa", current: "sha256:bbbb" },
			"0.1.0",
			true,
		);
		const [marker, ...rest] = rendered.split("\n");
		const withUnknownLine = [
			marker,
			"-- some-future-line: unknown",
			...rest,
		].join("\n");

		expect(parseBannerVersion(withUnknownLine)).toBe("0.1.0");
		expect(parseBannerBaseline(withUnknownLine)).toBe(true);
		expect(parseBannerHashes(withUnknownLine)).toEqual({
			parent: "sha256:aaaa",
			current: "sha256:bbbb",
		});
	});
});

describe("renderMigrationPrefix", () => {
	it("renders just the prefix half, matching migrationFileName's own prefix (#220)", () => {
		expect(
			renderMigrationPrefix({
				strategy: "timestamp",
				generatedAt: fixedDate,
				previousCount: 0,
				slug: "ignored",
			}),
		).toBe("20260819143052");
	});
});

describe("migrationVersionOf", () => {
	it("parses a timestamp/unix/index-shaped prefix", () => {
		expect(migrationVersionOf("20260822014246_add_posts.sql")).toBe(
			"20260822014246",
		);
		expect(migrationVersionOf("1755840000_add_posts.sql")).toBe("1755840000");
		expect(migrationVersionOf("0007_add_posts.sql")).toBe("0007");
	});

	it("returns null for a non-numeric (legacy, hand-written) prefix", () => {
		expect(migrationVersionOf("legacy_no_hashes.sql")).toBeNull();
	});
});

// #220: Supabase (and any tool tracking *applied* migrations by this
// prefix, not the full filename) can only ever apply one of two files
// sharing a version -- the other silently never runs. This is the
// positive control for verify's duplicate-migration-version check: a
// same-version pair must be reported, in file-name order, and any
// non-colliding file must never appear in the result.
describe("findDuplicateVersionGroups", () => {
	it("reports a same-version pair, sorted by file name within the group", () => {
		expect(
			findDuplicateVersionGroups([
				"20260822014246_add_body.sql",
				"20260822014246_add_posts.sql",
				"20260822014300_drop_legacy.sql",
			]),
		).toEqual([
			{
				version: "20260822014246",
				fileNames: [
					"20260822014246_add_body.sql",
					"20260822014246_add_posts.sql",
				],
			},
		]);
	});

	it("returns [] when every version is unique (control)", () => {
		expect(
			findDuplicateVersionGroups([
				"20260822014245_add_posts.sql",
				"20260822014246_add_body.sql",
			]),
		).toEqual([]);
	});

	it("reports every colliding group, sorted by version, when there is more than one", () => {
		expect(
			findDuplicateVersionGroups([
				"0002_add_body.sql",
				"0001_add_posts.sql",
				"0002_add_slug.sql",
				"0001_add_title.sql",
			]),
		).toEqual([
			{
				version: "0001",
				fileNames: ["0001_add_posts.sql", "0001_add_title.sql"],
			},
			{
				version: "0002",
				fileNames: ["0002_add_body.sql", "0002_add_slug.sql"],
			},
		]);
	});

	it("names every participant in a 3-way collision, not just the first pair", () => {
		expect(
			findDuplicateVersionGroups([
				"20260822014246_add_a.sql",
				"20260822014246_add_b.sql",
				"20260822014246_add_c.sql",
			]),
		).toEqual([
			{
				version: "20260822014246",
				fileNames: [
					"20260822014246_add_a.sql",
					"20260822014246_add_b.sql",
					"20260822014246_add_c.sql",
				],
			},
		]);
	});

	it("never collides a legacy (non-numeric-prefix) file with anything", () => {
		expect(
			findDuplicateVersionGroups([
				"legacy_no_hashes.sql",
				"also_legacy.sql",
				"20260822014246_add_posts.sql",
			]),
		).toEqual([]);
	});
});

describe("deriveSlug", () => {
	it("derives add_<name> from a create change", () => {
		expect(deriveSlug([createChange])).toBe("add_posts");
	});
	it("derives alter_<name> from an alter change", () => {
		expect(deriveSlug([alterChange])).toBe("alter_posts");
	});
	it("derives drop_<name> from a drop change", () => {
		expect(deriveSlug([dropChange])).toBe("drop_old");
	});
	it("falls back to migration when there are no changes", () => {
		expect(deriveSlug([])).toBe("migration");
	});
});

describe("deriveExistingTransitionSlug (D106 R3, J13)", () => {
	const emptySnapshot: Snapshot = {
		formatVersion: 8,
		dialect: "postgres",
		objects: {},
	};

	const managedNode: JsonValue = { schema: "app", name: "widgets" };
	const existingNode: JsonValue = {
		schema: "app",
		name: "widgets",
		existing: true,
	};

	const snapshotWith = (key: string, node: JsonValue | undefined): Snapshot => {
		if (node === undefined) {
			return emptySnapshot;
		}
		return { ...emptySnapshot, objects: { [key]: node } };
	};

	it("names 'record_<table>' when a table's own existing marker appears (added declaration)", () => {
		const previous = snapshotWith("table:app.widgets", undefined);
		const next = snapshotWith("table:app.widgets", existingNode);
		expect(deriveExistingTransitionSlug(previous, next)).toBe("record_widgets");
	});

	it("names 'forget_<table>' when a table's own existing marker disappears (removed declaration)", () => {
		const previous = snapshotWith("table:app.widgets", existingNode);
		const next = snapshotWith("table:app.widgets", undefined);
		expect(deriveExistingTransitionSlug(previous, next)).toBe("forget_widgets");
	});

	it("names 'release_<table>' for a handover (managed -> existing, same identity)", () => {
		const previous = snapshotWith("table:app.widgets", managedNode);
		const next = snapshotWith("table:app.widgets", existingNode);
		expect(deriveExistingTransitionSlug(previous, next)).toBe(
			"release_widgets",
		);
	});

	it("names 'adopt_<table>' for an adoption (existing -> managed, same identity)", () => {
		const previous = snapshotWith("table:app.widgets", existingNode);
		const next = snapshotWith("table:app.widgets", managedNode);
		expect(deriveExistingTransitionSlug(previous, next)).toBe("adopt_widgets");
	});

	it("uses the last dot-segment of the identity, not the full schema-qualified key", () => {
		const previous = snapshotWith("table:billing.ledger", undefined);
		const next = snapshotWith("table:billing.ledger", {
			schema: "billing",
			name: "ledger",
			existing: true,
		});
		expect(deriveExistingTransitionSlug(previous, next)).toBe("record_ledger");
	});

	it("picks the first transition in stable sorted key order when several tables move at once", () => {
		const previous: Snapshot = { ...emptySnapshot, objects: {} };
		const next: Snapshot = {
			...emptySnapshot,
			objects: {
				"table:app.zebra": { schema: "app", name: "zebra", existing: true },
				"table:app.aardvark": {
					schema: "app",
					name: "aardvark",
					existing: true,
				},
			},
		};
		// "app.aardvark" sorts before "app.zebra" -- the first difference in
		// that order wins, not declaration or object-literal order.
		expect(deriveExistingTransitionSlug(previous, next)).toBe(
			"record_aardvark",
		);
	});

	// D106 R4, R4-B1: both sides marked existing, but the declared columns
	// differ -- the fifth transition, reached only when the two sides'
	// content actually differs (not by side-category alone, unlike the
	// other four).
	it("names 'reshape_<table>' when both sides are existing but the declared shape differs", () => {
		const previous = snapshotWith("table:auth.users", existingNode);
		const next = snapshotWith("table:auth.users", {
			...existingNode,
			columns: [{ name: "email" }],
		});
		expect(deriveExistingTransitionSlug(previous, next)).toBe("reshape_users");
	});

	it("keeps scanning past an unchanged existing:existing table to find the real mover, even when it sorts first", () => {
		const previous: Snapshot = {
			...emptySnapshot,
			objects: {
				"table:app.same_shape": existingNode,
				"table:app.zzz_reshaped": existingNode,
			},
		};
		const next: Snapshot = {
			...emptySnapshot,
			objects: {
				// Sorts before "app.zzz_reshaped" but carries no content
				// difference -- must be skipped, not mistaken for the mover.
				"table:app.same_shape": existingNode,
				"table:app.zzz_reshaped": { ...existingNode, columns: [{ name: "x" }] },
			},
		};
		expect(deriveExistingTransitionSlug(previous, next)).toBe(
			"reshape_zzz_reshaped",
		);
	});

	it("throws a coded HejbroError, not a raw Error, when the two snapshots carry no explaining transition at all (D106 R4, R4-B1)", () => {
		const same = snapshotWith("table:app.widgets", managedNode);
		expect(() => deriveExistingTransitionSlug(same, same)).toThrow(
			expect.objectContaining({
				name: "HejbroError",
				code: "existing-transition-not-found",
			}),
		);
	});
});
