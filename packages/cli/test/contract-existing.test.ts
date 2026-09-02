import { existingTable, schema, table, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { emitContract } from "../src/contract/emit";
import { buildFixturePayload } from "./support/contract-fixture";
import { loadEmittedContract } from "./support/load-emitted-contract";

const app = schema("app");
const ORIGIN = {
	source: "git" as const,
	commit: "abc123",
	exportHash: "sha256:deadbeef",
};

const buildFixture = () => {
	const authUsers = existingTable("auth", "users", {
		id: uuid().primaryKey(),
	});
	const posts = table(app, "posts", {
		id: uuid().primaryKey().defaultRandom(),
		authorId: uuid()
			.notNull()
			.references(() => authUsers.id),
	});
	return { authUsers, posts };
};

describe("the contract marks an existing table (add-unmanaged-objects, 3.1)", () => {
	// Text assertions alone have missed a module that parses fine as a
	// string but throws (or silently carries the wrong value) once a real
	// JS engine evaluates it (planner instruction) -- this pin actually
	// loads `emitContract`'s own output as a real ES module and reads the
	// runtime value, rather than pattern-matching the source text.
	it("emits an existing table under Tables, marked", async () => {
		const { authUsers, posts } = buildFixture();
		const payload = buildFixturePayload([app, authUsers, posts]);
		const source = emitContract(payload, ORIGIN);

		const loaded = await loadEmittedContract(source);
		const usersMeta = loaded.contractMetadata.tables.users;
		const postsMeta = loaded.contractMetadata.tables.posts;

		expect(usersMeta).toBeDefined();
		expect(usersMeta?.existing).toBe(true);
		expect(postsMeta).toBeDefined();
		// Compact (D57, lead judgement): a managed table's own meta entry
		// carries no `existing` key at all, not `existing: false` -- the
		// reverse of the export description's always-present convention.
		expect(Object.hasOwn(postsMeta ?? {}, "existing")).toBe(false);
	});

	// Green on arrival, not new in 3.1: `computeTables` (emit.ts) has kept
	// every exported table fact, existing or managed, since before this
	// task -- 2.1's export already carried the existing table's own facts
	// and G1's snapshot already carried its shape, so nothing in the
	// `Tables`/`Row`/`Insert`/`Update` renderer ever excluded it. Pinned
	// (not left untested) because this is exactly the guarantee 3.1's own
	// proposal names, and the probe below shows it is load-bearing.
	it("green on arrival: an existing table already appears under Tables with its own Row/Insert/Update", () => {
		const { authUsers } = buildFixture();
		const payload = buildFixturePayload([app, authUsers]);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain('"users": {');
		expect(source).toContain("readonly Row: {");
		expect(source).toContain("readonly id: string;");
	});

	// Green on arrival, not new in 3.1: `buildRelationships`
	// (`contract/tables.ts`) decides by `findTableInSnapshot` -- whether
	// the snapshot carries a `table:` entry for the referenced identity at
	// all, never by managed/existing -- so this has been true since G1
	// made an existing declaration a real snapshot entry. The control
	// below (an entirely undeclared target) is the other side of that
	// same rule, already pinned by `contract-emit.test.ts`'s own "no
	// relation is derived for an unmanaged target" (5.9) -- not repeated
	// here, only cited.
	it("a foreign key onto a declared existing table resolves to a relation", () => {
		const { authUsers, posts } = buildFixture();
		const payload = buildFixturePayload([app, authUsers, posts]);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain('referencedRelation: "auth.users"');
	});
});
