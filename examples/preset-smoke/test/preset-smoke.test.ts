import {
	createDefaultRegistry,
	emptySnapshot,
	generateMigration,
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
});
