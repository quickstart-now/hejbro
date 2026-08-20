import type { KindRegistry } from "@hejbro/core";
import {
	createDefaultRegistry,
	emptySnapshot,
	generateMigration,
	schema,
} from "@hejbro/core";
import { registerSupabaseKinds, supabaseValidators } from "@hejbro/supabase";
import { describe, expect, it } from "vitest";
import {
	avatars,
	ddland,
	ddlandTablesGrant,
	drafts,
	profiles,
	profilesPublic,
} from "../src/dd-land.schema";

const buildRegistry = (): KindRegistry => {
	const registry = createDefaultRegistry();
	registerSupabaseKinds(registry);
	return registry;
};

describe("dd-land (reduced acceptance, D44)", () => {
	it("generates every preset feature once, with the two owner-approved warnings pinned", () => {
		const result = generateMigration({
			declarations: [
				ddland,
				profiles,
				drafts,
				avatars,
				ddlandTablesGrant,
				profilesPublic,
			],
			previousSnapshot: emptySnapshot,
			registry: buildRegistry(),
			validators: supabaseValidators,
		});
		expect(result.errors).toEqual([]);
		expect(result.hasChanges).toBe(true);
		expect(
			result.warnings.map((warning) => ({
				severity: warning.severity,
				code: warning.code,
				message: warning.message,
			})),
		).toEqual([
			{
				severity: "warning",
				code: "exposed-table-without-rls",
				message:
					'table "ddland"."drafts" is reachable by API roles (grant to "anon"/"authenticated" on schema "ddland") but has no row-level security — every row is readable/writable through the API. Declare rls(...) on the table, or drop the schema grant.',
			},
			{
				severity: "warning",
				code: "view-over-rls-without-security-invoker",
				message:
					'view "ddland"."profiles_public" reads RLS-protected table "ddland"."profiles" without security_invoker — the view runs with its owner\'s rights and bypasses row-level security (PG15+). Pass { securityInvoker: true } to defineView, or confirm the bypass is intended.',
			},
		]);
		// declaredAt is a best-effort captured stack location (per-environment
		// text) — pin its presence/type, not its exact value.
		expect(
			result.warnings.every(
				(warning) =>
					typeof warning.declaredAt === "string" || warning.declaredAt === null,
			),
		).toBe(true);
		expect(result.sql).toBe(
			[
				"-- hejbro migration",
				"-- + schema ddland [new]",
				"-- + table ddland.drafts [new]",
				"-- + table ddland.profiles [new]",
				"-- + rls ddland.profiles [new]",
				"-- + policy ddland.profiles.profiles_read_own [new]",
				"-- + view ddland.profiles_public [new]",
				"-- + grant ddland.allTablesPrivileges.anon [new]",
				"-- + supabase-storage-bucket avatars [new]",
				"",
				'create schema "ddland";',
				"",
				'create table "ddland"."drafts" (\n\t"id" uuid not null default gen_random_uuid(),\n\t"title" text not null,\n\tprimary key ("id")\n);',
				"",
				'create table "ddland"."profiles" (\n\t"id" uuid not null default gen_random_uuid(),\n\t"user_id" uuid not null,\n\t"display_name" text not null,\n\tprimary key ("id")\n);',
				"",
				'alter table "ddland"."profiles" enable row level security;',
				"",
				'drop policy if exists "profiles_read_own" on "ddland"."profiles";',
				"",
				'create policy "profiles_read_own" on "ddland"."profiles" for select to "authenticated" using ("ddland"."profiles"."user_id" = auth.uid());',
				"",
				'create or replace view "ddland"."profiles_public" as select "id", "user_id", "display_name" from "ddland"."profiles";',
				"",
				'grant select on all tables in schema "ddland" to "anon";',
				"",
				'insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")\nvalues (\'avatars\', \'avatars\', true, null, null)\non conflict ("id") do update set\n  "public" = excluded."public",\n  "file_size_limit" = excluded."file_size_limit",\n  "allowed_mime_types" = excluded."allowed_mime_types";',
				"",
				'alter table "ddland"."profiles" add constraint "profiles_user_id_fk" foreign key ("user_id") references "auth"."users" ("id");',
			].join("\n"),
		);
	});

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
				ddland,
				profiles,
				drafts,
				avatars,
				ddlandTablesGrant,
				profilesPublic,
			],
			previousSnapshot: emptySnapshot,
			registry,
			validators: supabaseValidators,
		});
		const withoutBucket = generateMigration({
			declarations: [
				ddland,
				profiles,
				drafts,
				ddlandTablesGrant,
				profilesPublic,
			],
			previousSnapshot: withBucket.snapshot,
			registry,
			validators: supabaseValidators,
		});
		expect(withoutBucket.sql).toContain(
			"-- - supabase-storage-bucket avatars [dropped:",
		);
		expect(withoutBucket.sql).not.toMatch(/insert into storage\.buckets/);
	});
});
