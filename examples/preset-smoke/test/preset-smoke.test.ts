import type { KindChange } from "@hejbro/core";
import {
	createDefaultRegistry,
	emptySnapshot,
	generateMigration,
	HejbroError,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { app, appNote, events } from "../src/app.schema";
import { schemaNoteKind } from "../src/preset";

describe("preset-smoke", () => {
	it("proves the extension interface is generic: a custom kind + an expression helper, zero Supabase concepts", () => {
		const registry = createDefaultRegistry();
		registry.register(schemaNoteKind);
		const result = generateMigration({
			declarations: [app, appNote, events],
			previousSnapshot: emptySnapshot,
			registry,
		});
		expect(result.hasChanges).toBe(true);
		expect(result.sql).toBe(
			[
				"-- hejbro migration",
				"-- + schema app [new]",
				"-- + table app.events [new]",
				"-- + smoke-schema-note app [new]",
				"",
				'create schema "app";',
				"",
				'create table "app"."events" (\n\t"id" uuid not null default gen_random_uuid(),\n\t"created_txid" integer not null default txid_current(),\n\tconstraint "events_pkey" primary key ("id")\n);',
				"",
				"comment on schema \"app\" is 'declared by preset-smoke, proving @hejbro/core''s extension interface is generic.';",
			].join("\n"),
		);
	});

	it("drops the custom kind's object, proving the standard drop diff path too", () => {
		const registry = createDefaultRegistry();
		registry.register(schemaNoteKind);
		const previousSnapshot = generateMigration({
			declarations: [app, appNote, events],
			previousSnapshot: emptySnapshot,
			registry,
		}).snapshot;
		const result = generateMigration({
			declarations: [app, events],
			previousSnapshot,
			registry,
		});
		expect(result.hasChanges).toBe(true);
		expect(result.sql).toBe(
			[
				"-- hejbro migration",
				"-- - smoke-schema-note app [dropped]",
				"",
				'comment on schema "app" is null;',
			].join("\n"),
		);
	});

	// #515: schemaNoteKind's create/alter/drop guards fold onto core's
	// exported requireNext/requirePrevious -- the refusal now names the
	// change by its kind token ("smoke-schema-note"), as core's own kinds
	// do, rather than the former inline "schema note" text.
	describe("emit refuses a change missing the snapshot it needs (#515)", () => {
		it("create with no next snapshot throws invalid-kind-change", () => {
			const change: KindChange = {
				kind: "smoke-schema-note",
				operation: "create",
				identity: "app",
				previous: null,
				next: null,
				notes: [],
			};
			expect(() => schemaNoteKind.emit(change, [], undefined)).toThrow(
				"smoke-schema-note create change is missing its next snapshot.",
			);
			try {
				schemaNoteKind.emit(change, [], undefined);
				throw new Error("expected emit to throw");
			} catch (error) {
				expect(error).toBeInstanceOf(HejbroError);
				expect((error as HejbroError).code).toBe("invalid-kind-change");
			}
		});

		it("alter with no next snapshot throws invalid-kind-change", () => {
			const change: KindChange = {
				kind: "smoke-schema-note",
				operation: "alter",
				identity: "app",
				previous: { schemaName: "app", note: "old" },
				next: null,
				notes: [],
			};
			expect(() => schemaNoteKind.emit(change, [], undefined)).toThrow(
				"smoke-schema-note alter change is missing its next snapshot.",
			);
			try {
				schemaNoteKind.emit(change, [], undefined);
				throw new Error("expected emit to throw");
			} catch (error) {
				expect(error).toBeInstanceOf(HejbroError);
				expect((error as HejbroError).code).toBe("invalid-kind-change");
			}
		});

		it("drop with no previous snapshot throws invalid-kind-change", () => {
			const change: KindChange = {
				kind: "smoke-schema-note",
				operation: "drop",
				identity: "app",
				previous: null,
				next: null,
				notes: [],
			};
			expect(() => schemaNoteKind.emit(change, [], undefined)).toThrow(
				"smoke-schema-note drop change is missing its previous snapshot.",
			);
			try {
				schemaNoteKind.emit(change, [], undefined);
				throw new Error("expected emit to throw");
			} catch (error) {
				expect(error).toBeInstanceOf(HejbroError);
				expect((error as HejbroError).code).toBe("invalid-kind-change");
			}
		});
	});
});
