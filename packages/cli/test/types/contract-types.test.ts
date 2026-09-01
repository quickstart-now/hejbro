import type { HejbroInput } from "@hejbro/core";
import {
	bigint,
	numeric,
	pgEnum,
	schema,
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
		expect(source).not.toContain("post_id");
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
