import { describe, expect, it } from "vitest";
import type { KindChange } from "../src/kind/object-kind";
import {
	deriveSlug,
	migrationFileName,
	parseBannerHashes,
	renderBanner,
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
