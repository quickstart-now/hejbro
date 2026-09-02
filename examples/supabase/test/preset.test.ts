import {
	createDefaultRegistry,
	emptySnapshot,
	generateMigration,
} from "@hejbro/core";
import { registerSupabaseKinds, supabaseValidators } from "@hejbro/supabase";
import type { KindRegistry } from "hejbro";
import { schema } from "hejbro";
import { describe, expect, it } from "vitest";
import {
	app,
	appTablesGrant,
	attachments,
	attachmentsBucket,
	drafts,
	profiles,
	profilesPublic,
} from "../src/app.schema";

const buildRegistry = (): KindRegistry => {
	const registry = createDefaultRegistry();
	registerSupabaseKinds(registry);
	return registry;
};

// Positive-path coverage (every feature once, both warnings pinned) lives in
// chain.test.ts/cli.test.ts (Task 24) — this file keeps only the two
// negative cases that don't fit the step-chain shape.
describe("examples/supabase preset (negative cases)", () => {
	it('schema("auth") hard-errors via reservedSchemaValidator (negative case)', () => {
		const authSchema = schema("auth");
		const result = generateMigration({
			declarations: [authSchema],
			previousSnapshot: emptySnapshot,
			registry: buildRegistry(),
			validators: supabaseValidators,
		});
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe("reserved-schema");
		expect(result.sql).toBe("");
		expect(result.hasChanges).toBe(false);
	});

	it("dropping the bucket surfaces the D42 manual-deletion note in the banner", () => {
		const registry = buildRegistry();
		const withBucket = generateMigration({
			declarations: [
				app,
				profiles,
				attachments,
				drafts,
				attachmentsBucket,
				appTablesGrant,
				profilesPublic,
			],
			previousSnapshot: emptySnapshot,
			registry,
			validators: supabaseValidators,
		});
		const withoutBucket = generateMigration({
			declarations: [
				app,
				profiles,
				attachments,
				drafts,
				appTablesGrant,
				profilesPublic,
			],
			previousSnapshot: withBucket.snapshot,
			registry,
			validators: supabaseValidators,
		});
		expect(withoutBucket.sql).toContain(
			"-- - supabase-storage-bucket attachments [dropped:",
		);
		expect(withoutBucket.sql).not.toMatch(/insert into storage\.buckets/);
	});
});
