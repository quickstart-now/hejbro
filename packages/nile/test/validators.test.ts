import {
	bigserial,
	defineFunction,
	defineTrigger,
	emptySnapshot,
	eq,
	generateMigration,
	grant,
	integer,
	rls,
	roleName,
	schema,
	select,
	serial,
	smallserial,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { nilePreset } from "../src/preset";
import {
	nileFunctionTriggerValidator,
	nileRlsValidator,
	nileSerialValidator,
} from "../src/validators";

const app = schema("app");

// The preset's own registered array (`packages/nile/src/preset.ts`), not a
// hand-copied parallel list -- every scenario below exercises the exact
// set a real `presets: [nilePreset]` registration runs, so a validator
// dropped from that array (accidentally or by a bad edit) is caught here
// too, not only by preset.test.ts's own count assertion.
const allValidators = nilePreset.validators;

describe("RLS and policies are refused, with platform attribution (task 4.1, #566)", () => {
	it("a policy declaration fails generation, names it, and attributes the limitation to the platform", () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: uuid().notNull() },
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("posts_read")
						.for("select")
						.to("reader")
						.using(eq(t.id, t.id)),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, posts],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.sql).toBe("");
		expect(result.hasChanges).toBe(false);
		const codes = result.errors.map((error) => error.code);
		expect(codes).toContain("nile-rls-unsupported");
		const messages = result.errors.map((error) => error.message).join("\n");
		expect(messages).toMatch(/posts/);
		expect(messages).toMatch(
			/documented in the platform's published limitations/,
		);
	});
});

describe("Functions and triggers are refused, with platform attribution (task 4.2, #566)", () => {
	it("a function declaration fails generation, naming it", () => {
		const widgets = table(app, "widgets", { id: uuid().primaryKey() });
		const helloWorld = defineFunction(
			app,
			"hello_world",
			{ returns: widgets },
			(ctx) => {
				ctx.return(select(widgets));
			},
		);
		const result = generateMigration({
			declarations: [app, widgets, helloWorld],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.sql).toBe("");
		const messages = result.errors.map((error) => error.message).join("\n");
		expect(result.errors.map((error) => error.code)).toContain(
			"nile-function-unsupported",
		);
		expect(messages).toMatch(/hello_world/);
		expect(messages).toMatch(
			/documented in the platform's published limitations/,
		);
	});

	it("a trigger declaration fails generation, naming it", () => {
		const widgets = table(app, "widgets", { id: uuid().primaryKey() });
		const guard = defineTrigger(
			widgets,
			{ name: "guard", timing: "before", events: ["insert"], forEach: "row" },
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const result = generateMigration({
			declarations: [app, widgets, guard],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.sql).toBe("");
		const messages = result.errors.map((error) => error.message).join("\n");
		// exactly one diagnostic (D106 F8) -- the trigger's own synthesized
		// function (core's resolveDeclarations fan-out) must not also be
		// refused as a separate, unrelated function declaration.
		expect(result.errors).toHaveLength(1);
		expect(result.errors.map((error) => error.code)).toEqual([
			"nile-trigger-unsupported",
		]);
		expect(messages).toMatch(/guard/);
		expect(messages).toMatch(
			/documented in the platform's published limitations/,
		);
	});
});

describe("Grants are refused, and the error says it was measured (task 4.3, #566)", () => {
	it("a grant declaration fails generation, and the message carries the measured-not-documented distinction", () => {
		const grants = grant(app).usage.to(roleName("reader"));
		const result = generateMigration({
			declarations: [app, ...grants.grants],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.sql).toBe("");
		const messages = result.errors.map((error) => error.message).join("\n");
		expect(result.errors.map((error) => error.code)).toContain(
			"nile-grant-unsupported",
		);
		expect(messages).toMatch(
			/this refusal rests on a measurement, not on the platform's published limitations/,
		);
	});
});

describe("Every serial-family column in a tenant-aware table is refused (task 4.4, #566)", () => {
	it.each([
		["serial", serial],
		["smallserial", smallserial],
		["bigserial", bigserial],
	])("%s fails generation in a table with tenant_id uuid", (_name, column) => {
		const widgets = table(app, "widgets", {
			id: column().primaryKey(),
			tenantId: uuid().notNull(),
		});
		const result = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.sql).toBe("");
		const messages = result.errors.map((error) => error.message).join("\n");
		expect(result.errors.map((error) => error.code)).toContain(
			"nile-serial-in-tenant-table",
		);
		expect(messages).toMatch(
			/this refusal rests on a measurement, not on the platform's published limitations/,
		);
	});

	it("the same serial column in a table without tenant_id passes", () => {
		const counters = table(app, "counters", {
			id: serial().primaryKey(),
		});
		const result = generateMigration({
			declarations: [app, counters],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.errors).toEqual([]);
	});
});

describe("What the platform accepts is untouched, and no other preset's output changes (task 4.5, #566)", () => {
	it("a tenant-aware table with no refused declaration generates exactly the SQL it generates with no preset registered", () => {
		// composite primary key (tenant_id included) -- since the fifth
		// validator added after G5, a lone `id` primary key on a
		// tenant-aware table is itself a refused shape; this fixture stays
		// a genuine "nothing refused" case.
		const widgets = table(app, "widgets", {
			id: uuid().primaryKey(),
			tenantId: uuid().primaryKey(),
		});

		const withValidators = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});
		const withoutValidators = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
		});

		expect(withValidators.errors).toEqual([]);
		expect(withValidators.sql).toBe(withoutValidators.sql);
	});

	it("mutation-proof: removing one refusal (grants) leaves the other three intact -- a bad edit is caught by exactly the scenario it breaks", () => {
		const grants = grant(app).usage.to(roleName("reader"));
		const withoutGrantValidator = [
			nileRlsValidator,
			nileFunctionTriggerValidator,
			nileSerialValidator,
		];
		const result = generateMigration({
			declarations: [app, ...grants.grants],
			previousSnapshot: emptySnapshot,
			validators: withoutGrantValidator,
		});

		// this is the fixed point a real "remove nileGrantValidator from
		// the array" mutation is checked against, performed out-of-band
		// per this group's own TDD discipline (temporary edit to
		// preset.ts's own validators array, rerun, revert via file copy) --
		// only the grant scenario should go red, not the other three.
		expect(result.errors).toEqual([]);
	});
});

describe("A tenant-aware table's primary key must include tenant_id (added after G5's own live-witness measurement, #567)", () => {
	it("a lone id primary key on a tenant-aware table is refused, and the error says it was measured", () => {
		const widgets = table(app, "widgets", {
			id: uuid().primaryKey(),
			tenantId: uuid().notNull(),
		});
		const result = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.sql).toBe("");
		expect(result.errors.map((error) => error.code)).toEqual([
			"nile-tenant-primary-key-missing",
		]);
		expect(result.errors[0]?.message).toMatch(/widgets/);
		// D106 F10: the message states the declared key's own column set.
		expect(result.errors[0]?.message).toMatch(/primary key \(id\)/);
		expect(result.errors[0]?.message).toMatch(
			/this refusal rests on a measurement, not on the platform's published limitations/,
		);
	});

	it("a composite primary key that includes tenant_id passes", () => {
		const widgets = table(app, "widgets", {
			id: uuid().primaryKey(),
			tenantId: uuid().primaryKey(),
		});
		const result = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.errors).toEqual([]);
	});

	it("a table with no tenant_id column and a lone primary key is untouched (out of the measured scope)", () => {
		const counters = table(app, "counters", {
			id: uuid().primaryKey(),
		});
		const result = generateMigration({
			declarations: [app, counters],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.errors).toEqual([]);
	});

	it("a tenant-aware table with no primary key at all is accepted -- measured on the container 2026-08-31 (#573): `create table (tenant_id uuid not null, name text)` succeeds and takes rows under a tenant context", () => {
		const widgets = table(app, "widgets", {
			id: uuid(),
			tenantId: uuid().notNull(),
		});
		const result = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.errors).toEqual([]);
	});

	it("mutation-proof: removing this validator leaves the lone-id-primary-key scenario passing, and only that scenario", () => {
		const widgets = table(app, "widgets", {
			id: uuid().primaryKey(),
			tenantId: uuid().notNull(),
		});
		const withoutThisValidator = [
			nileRlsValidator,
			nileFunctionTriggerValidator,
			nileSerialValidator,
		];
		const result = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
			validators: withoutThisValidator,
		});

		// this is the fixed point a real "remove
		// nileTenantPrimaryKeyValidator from the array" mutation is checked
		// against (temporary edit to preset.ts's own validators array,
		// rerun, revert via file copy) -- only this scenario should go red,
		// not the other four (4.1-4.5).
		expect(result.errors).toEqual([]);
	});
});

describe("every refusal names a way forward (preset-validation: 'gives the caller a way forward'), lead-flagged gap (#568 in-flight)", () => {
	it("every refusal kind's error messages carry a 'Next: ' clause -- one loop, so a new validator is covered automatically", () => {
		const widgets = table(
			app,
			"widgets",
			{
				id: bigserial().primaryKey(),
				tenantId: uuid().notNull(),
				seq: integer().generatedByDefaultAsIdentity(),
				status: uuid().notNull(),
			},
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("widgets_read")
						.for("select")
						.to("reader")
						.using(eq(t.id, t.id)),
				}),
			}),
		);
		const helloWorld = defineFunction(
			app,
			"hello_world",
			{ returns: widgets },
			(ctx) => {
				ctx.return(select(widgets));
			},
		);
		const guard = defineTrigger(
			widgets,
			{ name: "guard", timing: "before", events: ["insert"], forEach: "row" },
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const grants = grant(app).usage.to(roleName("reader"));

		const result = generateMigration({
			declarations: [app, widgets, helloWorld, guard, ...grants.grants],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		// seven distinct codes confirms every kind actually fired, not just
		// "some errors happened to carry Next:" -- rls-unsupported fires
		// twice here (the RLS declaration itself, and its one policy),
		// serial-in-tenant-table once (the bigserial primary key). This
		// fixture's own primary key is `id` alone (never `tenant_id`), so
		// the tenant-primary-key validator fires here too -- unplanned but
		// consistent with the fixture's own shape, not a fixture this test
		// crafted for that validator specifically (that gets its own
		// dedicated describe block below).
		const codes = result.errors.map((error) => error.code);
		expect(new Set(codes)).toEqual(
			new Set([
				"nile-rls-unsupported",
				"nile-function-unsupported",
				"nile-trigger-unsupported",
				"nile-grant-unsupported",
				"nile-serial-in-tenant-table",
				"nile-identity-in-tenant-table",
				"nile-tenant-primary-key-missing",
			]),
		);
		expect(result.errors.length).toBeGreaterThanOrEqual(8);
		result.errors.forEach((error) => {
			expect(error.message).toContain("Next: ");
		});
	});
});

describe("An identity column in a tenant-aware table is refused (measured on the container 2026-08-31, #573)", () => {
	it.each([
		[
			"generated always as identity",
			() => integer().generatedAlwaysAsIdentity(),
		],
		[
			"generated by default as identity",
			() => integer().generatedByDefaultAsIdentity(),
		],
	])(
		"%s fails generation in a table with tenant_id uuid, and the error says it was measured",
		(_name, column) => {
			const widgets = table(app, "widgets", {
				id: uuid().primaryKey(),
				tenantId: uuid().primaryKey(),
				seq: column(),
			});
			const result = generateMigration({
				declarations: [app, widgets],
				previousSnapshot: emptySnapshot,
				validators: allValidators,
			});

			expect(result.sql).toBe("");
			expect(result.errors.map((error) => error.code)).toEqual([
				"nile-identity-in-tenant-table",
			]);
			expect(result.errors[0]?.message).toMatch(/"seq"/);
			expect(result.errors[0]?.message).toMatch(
				/this refusal rests on a measurement, not on the platform's published limitations/,
			);
			expect(result.errors[0]?.message).toContain("Next: ");
		},
	);

	it("the same identity column in a table without tenant_id passes -- the platform's restriction is about tenant-aware tables", () => {
		const counters = table(app, "counters", {
			id: integer().generatedAlwaysAsIdentity().primaryKey(),
		});
		const result = generateMigration({
			declarations: [app, counters],
			previousSnapshot: emptySnapshot,
			validators: allValidators,
		});

		expect(result.errors).toEqual([]);
	});
});
