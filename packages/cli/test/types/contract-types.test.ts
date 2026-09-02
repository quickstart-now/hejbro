import type { HejbroInput } from "@hejbro/core";
import {
	bigint,
	numeric,
	pgEnum,
	schema,
	serial,
	sql,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { emitContract } from "../../src/contract/emit";
import { buildFixturePayload } from "../support/contract-fixture";

const app = schema("app");

/**
 * A single string-based assertion suite over the emitted source text
 * (schema-vendoring spec, "The contract reproduces the consumer-visible
 * type layer") — the codebase's own established pattern for a generated
 * artifact's own textual contract (banner lines, overwrite-guard
 * markers), rather than dynamically importing the freshly emitted
 * module and type-checking it, which TypeScript's own static import
 * resolution cannot do against a file generated at test run time.
 */
const emitSource = (
	declarations: ReadonlyArray<HejbroInput>,
	exportNames?: ReadonlyMap<HejbroInput, string>,
): string =>
	emitContract(buildFixturePayload(declarations, exportNames), {
		commit: "abc123",
		exportHash: "sha256:deadbeef",
	});

describe("row keys match the declaring repository (5.2)", () => {
	it("row keys are the declared TypeScript keys", () => {
		const posts = table(app, "posts", {
			postId: uuid().primaryKey().defaultRandom(),
		});
		const source = emitSource([app, posts]);

		expect(source).toContain("readonly postId: string;");
		// The `Database` interface itself never spells the SQL name -- only
		// the metadata's own runtime name map does (5.1 follow-up), so the
		// SQL name is absent from everything before that map starts.
		const beforeMetadata = source.split("export const contractMetadata")[0];
		expect(beforeMetadata).not.toContain("post_id");
	});
});

describe("element nullability follows the declaration (5.4)", () => {
	it("non-null elements are not nullable", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			tags: text().array().notNullElements(),
		});
		const source = emitSource([app, posts]);

		expect(source).toContain("readonly tags: ReadonlyArray<string> | null;");
	});

	it("nullable elements keep their | null", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			tags: text().array(),
		});
		const source = emitSource([app, posts]);

		expect(source).toContain(
			"readonly tags: ReadonlyArray<string | null> | null;",
		);
	});
});

describe("numeric mode follows the declaration (5.4)", () => {
	it("a bigint column with mode: 'bigint' reads back as bigint", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			views: bigint({ mode: "bigint" }).notNull(),
		});
		const source = emitSource([app, posts]);

		expect(source).toContain("readonly views: bigint;");
	});

	it("a bigint column with no mode defaults to bigint (never a narrower type)", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			views: bigint().notNull(),
		});
		const source = emitSource([app, posts]);

		expect(source).toContain("readonly views: bigint;");
	});

	it("a numeric column with no mode defaults to string (never a lossy number)", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			total: numeric().notNull(),
		});
		const source = emitSource([app, posts]);
		expect(source).toContain("readonly total: string;");
	});
});

describe("enum columns keep their values (5.4)", () => {
	it("an enum types as the union of its declared values", () => {
		const mood = pgEnum(app, "mood", ["sad", "ok", "happy"]);
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			mood: mood.column().notNull(),
		});
		const source = emitSource([app, mood, posts]);

		expect(source).toContain('readonly mood: "sad" | "ok" | "happy";');
		expect(source).toContain('"sad" | "ok" | "happy"');
	});
});

describe("write inputs follow what the database does (5.3)", () => {
	it("defaulted optional, computed absent, identity optional", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			title: text().notNull(),
			createdAt: text().notNull().default("has-default"),
			slug: text().notNull().generatedAlwaysAs(sql`lower(title)`),
			sequenceNumber: bigint({ mode: "bigint" }).generatedByDefaultAsIdentity(),
		});
		const source = emitSource([app, posts]);

		// `id` has a default (`defaultRandom`) -- optional on insert.
		expect(source).toMatch(/Insert: \{[\s\S]*?readonly id\?: string;/);
		// `title` is required: notNull, no default.
		expect(source).toMatch(/Insert: \{[\s\S]*?readonly title: string;/);
		// `createdAt` has an explicit default -- optional.
		expect(source).toMatch(/Insert: \{[\s\S]*?readonly createdAt\?: string;/);
		// `slug` is a stored generated column -- absent from Insert entirely.
		const insertBlock = source.match(/Insert: \{([\s\S]*?)\};/)?.[1] ?? "";
		expect(insertBlock).not.toContain("slug");
		// `sequenceNumber` is a by-default identity -- optional, present.
		expect(insertBlock).toContain("sequenceNumber?: bigint");
	});

	it("update always keeps every writable column optional", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			title: text().notNull(),
		});
		const source = emitSource([app, posts]);

		expect(source).toMatch(/Update: \{[\s\S]*?readonly id\?: string;/);
		expect(source).toMatch(/Update: \{[\s\S]*?readonly title\?: string;/);
	});

	it("a serial column is optional on insert, derived from its owning sequence (planner-confirmed, no new sidecar fact)", () => {
		const posts = table(app, "posts", {
			id: serial().primaryKey(),
			title: text().notNull(),
		});
		const source = emitSource([app, posts]);

		const insertBlock = source.match(/Insert: \{([\s\S]*?)\};/)?.[1] ?? "";
		expect(insertBlock).toContain("readonly id?: number;");
	});
});

describe("a branded column reads as its unbranded type (5.5)", () => {
	it("a $type brand never reaches the emitted column type", () => {
		const posts = table(app, "posts", {
			id: uuid()
				.primaryKey()
				.defaultRandom()
				.$type<string & { readonly __brand: "PostId" }>(),
		});
		const source = emitSource([app, posts]);

		expect(source).toContain("readonly id: string;");
		expect(source).not.toContain("__brand");
		expect(source).not.toContain("PostId");
	});
});

describe("a no-arg function's Args type refuses an excess property (#587, 2.1)", () => {
	it("Record<string, never> refuses an excess property that a bare {} would silently accept", () => {
		// A no-arg function's emitted `Args` type is `Record<string, never>`,
		// never `{}` -- `{}` places no constraint on an object's own keys, so
		// a caller passing extra arguments to a no-arg function would type-
		// check against `{}` and only `Record<string, never>` actually
		// refuses it. This probe is evidence for `check-types`, not
		// `vitest run` (`@ts-expect-error` is a runtime no-op).
		const callWithNoArgFunctionArgs = (args: Record<string, never>): void => {
			void args;
		};
		callWithNoArgFunctionArgs({});
		// @ts-expect-error an excess property against Record<string, never> -- the property Args's own emitted type exists to catch.
		callWithNoArgFunctionArgs({ extra: 1 });
	});
});
