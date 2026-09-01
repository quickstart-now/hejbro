import type { Expr } from "@hejbro/core";
import { eq, jsonObjectFrom, select } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractTableMeta } from "../../src/client/contract-types";
import { synthesizeTable } from "../../src/client/synthesize";
import type { CompileResult } from "../../src/compile/compile";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "../db/recording-driver";

/**
 * Relations, where the contract carries them (R2-G6 6.6) — proven at the
 * same internal seam 6.5's parity test uses: `synthesizeTable`'s own
 * reconstructed `foreignKeys` (from the contract's vendored
 * `Relationships`) feed `@hejbro/query`'s already-shipped `related()`
 * chain method unchanged. Exposing `.related()` on the public per-table
 * client is part of the richer query surface awaiting the lead's filter-
 * syntax ruling (same open point as `.where()`) — this test proves the
 * *mechanism* the eventual public surface will delegate to already
 * works, the same split 6.5's own test makes.
 *
 * `synthesizeTable`'s own return type is deliberately the widest
 * `DeclaredTable` (no per-column literal typing reaches it, matching
 * "no type parameter reaches the user"), so every column ref and the
 * `.related()` sugar are read off it through a narrow, test-local cast
 * rather than by fighting that generic inference — this test's own
 * assertions are about runtime wiring, not about re-typing a
 * deliberately untyped reconstruction.
 */
describe("relations follow the contract's own vendored foreign keys (R2-G6 6.6)", () => {
	it("a synthesized foreign key drives related() exactly like a declared one", () => {
		const authorsMeta: ContractTableMeta = {
			schema: "app",
			name: "authors",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		};
		const postsMeta: ContractTableMeta = {
			schema: "app",
			name: "posts",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				authorId: {
					sqlName: "author_id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [
				{
					name: "posts_author_id_fk",
					columns: ["author_id"],
					referencesSchema: "app",
					referencesTable: "authors",
					referencedColumns: ["id"],
				},
			],
		};
		const authors = synthesizeTable(authorsMeta);
		const posts = synthesizeTable(postsMeta);
		type Refs = { readonly id: Expr; readonly authorId: Expr };
		const authorsRefs = authors as unknown as Refs;
		const postsRefs = posts as unknown as Refs;

		const { driver } = recordingTransactionalDriver();
		const handle = db({ authors, posts }, driver);

		type Related = (spec: Readonly<Record<string, true>>) => {
			compile(): CompileResult;
		};
		const sugared = (handle.select(posts) as unknown as { related: Related })
			.related({ author: true })
			.compile();
		const explicit = compile(
			select(
				{
					id: postsRefs.id,
					authorId: postsRefs.authorId,
					author: jsonObjectFrom(
						select(authors).where(eq(authorsRefs.id, postsRefs.authorId)),
					),
				},
				posts,
			),
		);

		expect(sugared.sql).toBe(explicit.sql);
	});
});
