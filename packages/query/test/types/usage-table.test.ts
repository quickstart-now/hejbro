import {
	integer,
	schema,
	syncedGenerated,
	syncedHasDefault,
	syncedIdentity,
	syncedTable,
	text,
	timestamptz,
	uuid,
} from "@hejbro/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { InsertInput, UpdateInput } from "../../src/types/insert-input";
import type { RelatedResult, RelationKeysOf } from "../../src/types/relations";

const app = schema("app");
const usageUsers = syncedTable("app", "users", {
	id: uuid().primaryKey(),
	name: text().notNull(),
});
const usagePosts = syncedTable("app", "posts", {
	id: uuid().primaryKey(),
	title: text().notNull(),
	authorId: uuid()
		.notNull()
		.references(() => usageUsers.id),
	publishedAt: syncedHasDefault(timestamptz().notNull()),
	slug: syncedGenerated(text().notNull()),
	externalId: syncedIdentity(integer().notNull(), "byDefault"),
	sequenceNumber: syncedIdentity(integer().notNull(), "always"),
});

const usageSchema = { app, users: usageUsers, posts: usagePosts };

describe("a usage table keeps its relation keys and write inputs", () => {
	it("relation keys are the real key, not never", () => {
		expectTypeOf<
			RelationKeysOf<typeof usageSchema, typeof usagePosts>
		>().toEqualTypeOf<"author">();
	});

	it("related result rows carry the real row shape, not never", () => {
		type UsageRelated = RelatedResult<
			typeof usageSchema,
			typeof usagePosts,
			{ author: true }
		>;
		expectTypeOf<UsageRelated["author"]>().toEqualTypeOf<{
			readonly id: string;
			readonly name: string;
		} | null>();
	});

	it("InsertInput/UpdateInput carry the real column shape, not never/{}/unknown", () => {
		expectTypeOf<InsertInput<typeof usagePosts>>().not.toBeNever();
		expectTypeOf<UpdateInput<typeof usagePosts>>().not.toBeNever();
		const insertValue: InsertInput<typeof usagePosts> = {
			id: "id",
			title: "title",
			authorId: "author-id",
		};
		const updateValue: UpdateInput<typeof usagePosts> = {
			title: "updated",
		};
		expect(insertValue.title).toBe("title");
		expect(updateValue.title).toBe("updated");
	});

	it("a defaulted column is optional and a computed one is absent from writes", () => {
		// publishedAt (hasDefault) and externalId (identity byDefault) are
		// both optional -- omitting them here must still type-check.
		const insertValue: InsertInput<typeof usagePosts> = {
			id: "id",
			title: "title",
			authorId: "author-id",
		};
		expect(insertValue.title).toBe("title");

		// slug (generated) and sequenceNumber (identity always) have no key
		// at all -- keyof excludes them outright, not merely marks them
		// optional (D100 decision 5's ALWAYS-family write exclusion).
		expectTypeOf<keyof InsertInput<typeof usagePosts>>().toEqualTypeOf<
			"id" | "title" | "authorId" | "publishedAt" | "externalId"
		>();
	});
});
