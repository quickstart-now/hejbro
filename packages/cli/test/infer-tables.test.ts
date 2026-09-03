import type { ColumnBuilder, EnumDeclaration, HejbroInput } from "@hejbro/core";
import {
	emptySnapshot,
	generateMigration,
	pgEnum,
	schema,
	table,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { InferredColumnFacts } from "../src/infer/columns";
import { inferColumnDeclaration } from "../src/infer/columns";

const app = schema("app");

const baseFacts: InferredColumnFacts = {
	schema: "app",
	table: "widgets",
	name: "col",
	sqlType: "text",
	baseTypeName: "text",
	isArray: false,
	notNull: false,
	catalogDefault: null,
	identityKind: "",
	generatedKind: "",
	identityOptions: null,
	isSerialOwned: false,
	enumDeclaration: null,
};

/** Rebuilds a one-column table from a declaration result and returns the create-table SQL -- the black-box proof (team rule "generated code is proved by running it") that the builder `inferColumnDeclaration` returns is actually well-formed, not just shaped right internally. */
const createSqlFor = (
	builder: ColumnBuilder,
	extraDeclarations: ReadonlyArray<HejbroInput> = [],
): string => {
	const widgets = table(app, "widgets", { col: builder });
	const declarations: ReadonlyArray<HejbroInput> = [
		app,
		...extraDeclarations,
		widgets,
	];
	const migration = generateMigration({
		declarations,
		previousSnapshot: emptySnapshot,
	});
	expect(migration.errors).toEqual([]);
	return migration.sql;
};

describe("inferColumnDeclaration / 1.3 type -> builder", () => {
	it("maps a plain text column", () => {
		const result = inferColumnDeclaration({ ...baseFacts, notNull: true });

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		expect(createSqlFor(result.builder)).toContain('"col" text not null');
	});

	it("maps numeric(10,2) with precision and scale", () => {
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "numeric(10,2)",
			baseTypeName: "numeric",
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		expect(createSqlFor(result.builder)).toContain('"col" numeric(10,2)');
	});

	it("maps character varying(255) with length", () => {
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "character varying(255)",
			baseTypeName: "varchar",
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		// core's own emitter renders the builder's `varchar` type name, not
		// Postgres's `character varying` spelling that `format_type` used on
		// the way in (check/catalog.ts's own catalogType text) -- confirmed by
		// running it, not assumed.
		expect(createSqlFor(result.builder)).toContain('"col" varchar(255)');
	});

	it("records a loss for a type no column builder expresses", () => {
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "point",
			baseTypeName: "point",
		});

		expect(result).toEqual({
			kind: "loss",
			loss: {
				schema: "app",
				table: "widgets",
				column: "col",
				sqlType: "point",
			},
		});
	});

	it("records a loss for a domain type (its own typname, never its base type's)", () => {
		// A domain over text (e.g. `create domain email_address as text`) has
		// its own pg_type row and its own typname ("email_address") -- it is
		// never confused with plain `text` because check/catalog.ts's
		// baseTypeName is *this* type's typname, not the domain's base type
		// (CI-G1-R1-05 pt.2c: typtype 'd'/'c' etc, no special-casing needed --
		// the lookup already fails closed for any name it doesn't recognize).
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "email_address",
			baseTypeName: "email_address",
		});

		expect(result.kind).toBe("loss");
	});

	it("maps an array column to the element builder plus .array(), never asserting not-null elements", () => {
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "text[]",
			baseTypeName: "text",
			isArray: true,
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		const sql = createSqlFor(result.builder);
		// The catalog never says whether an array's elements are themselves
		// non-null (CI-G1-R1-05 pt.2b) -- the delta's own rule is to read
		// unknown element nullability as nullable and mark it guessed, which
		// means never emitting the `<column>_no_null_elements` CHECK
		// `.notNullElements()` would derive.
		expect(sql).toContain('"col" text[]');
		expect(sql).not.toContain("no_null_elements");
	});

	it("maps an enum column via the shared EnumDeclaration's own .column(), not a plain builder", () => {
		const mood = pgEnum(app, "mood", ["happy", "sad"] as const);
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "mood",
			baseTypeName: "mood",
			enumDeclaration: mood as EnumDeclaration,
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		const sql = createSqlFor(result.builder, [mood]);
		expect(sql).toContain('create type "app"."mood" as enum');
		expect(sql).toContain('"col" "app"."mood"');
	});
});

describe("inferColumnDeclaration / 1.3 default, identity, generated", () => {
	it("carries a catalog default verbatim as sql.raw, never re-derived", () => {
		const result = inferColumnDeclaration({
			...baseFacts,
			catalogDefault: "'anon'::text",
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		expect(createSqlFor(result.builder)).toContain("default 'anon'::text");
	});

	it("routes a stored generated column to generatedAlwaysAs, never default (CI-G1-R1-04)", () => {
		// The trap this test exists for: attgenerated = 's' columns keep their
		// expression in the same pg_attrdef row a plain default would use, so
		// a naive implementation reads catalogDefault and calls .default(),
		// producing a column that renders as DEFAULT instead of GENERATED
		// ALWAYS AS ... STORED -- a real behavioral bug, not a cosmetic one.
		const result = inferColumnDeclaration({
			...baseFacts,
			generatedKind: "s",
			catalogDefault: "(name || '!'::text)",
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		const sql = createSqlFor(result.builder);
		expect(sql).toContain("generated always as ((name || '!'::text)) stored");
		expect(sql).not.toContain("default");
	});

	it("declares only the identity options that differ from Postgres's own default", () => {
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "int8",
			baseTypeName: "int8",
			identityKind: "d",
			identityOptions: {
				startValue: "5",
				increment: "2",
				minValue: "1",
				maxValue: "9223372036854775807",
				cache: "1",
				cycle: false,
			},
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		const sql = createSqlFor(result.builder);
		expect(sql).toContain(
			"generated by default as identity (start with 5 increment by 2)",
		);
	});

	it("declares no identity options when every one matches Postgres's own default", () => {
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "int8",
			baseTypeName: "int8",
			identityKind: "a",
			identityOptions: {
				startValue: "1",
				increment: "1",
				minValue: "1",
				maxValue: "9223372036854775807",
				cache: "1",
				cycle: false,
			},
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		const sql = createSqlFor(result.builder);
		expect(sql).toContain("generated always as identity");
		expect(sql).not.toContain("start with");
		expect(sql).not.toContain("increment by");
	});
});

describe("inferColumnDeclaration / 1.5c serial ownership (CI-G1-R1-10 (D))", () => {
	it("maps a serial-owned integer column to the matching serial builder, never a raw nextval default", () => {
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "integer",
			baseTypeName: "int4",
			notNull: true,
			catalogDefault: "nextval('app.widgets_id_seq'::regclass)",
			isSerialOwned: true,
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		const sql = createSqlFor(result.builder);
		// Real generateMigration output (not guessed): core's own serial()
		// synthesizes a real sequence declaration plus an owned-by clause
		// and an explicit `set default nextval(...)`, rather than the
		// inline `col serial` shorthand -- the plain integer type is what
		// actually appears on the column itself.
		expect(sql).toContain('"col" integer not null');
		expect(sql).toContain('create sequence "app"."widgets_col_seq"');
		expect(sql).toContain(
			'alter sequence "app"."widgets_col_seq" owned by "app"."widgets"."col"',
		);
		expect(sql).toContain("set default nextval('app.widgets_col_seq')");
	});

	it("keeps a nextval default on a sequence this column does not own as a plain raw default, never serial (1.5c's own trap)", () => {
		// Same shape as the serial case above -- integer, not-null, a
		// nextval(...) default -- except isSerialOwned is false, the way
		// the adapter reports it for a column whose default merely
		// *references* a sequence with no `ALTER SEQUENCE ... OWNED BY`
		// relationship to this column at all. Converting this to serial()
		// would silently declare an ownership Postgres itself never made.
		const result = inferColumnDeclaration({
			...baseFacts,
			sqlType: "integer",
			baseTypeName: "int4",
			notNull: true,
			catalogDefault: "nextval('app.orphan_seq'::regclass)",
			isSerialOwned: false,
		});

		expect(result.kind).toBe("declared");
		if (result.kind !== "declared") {
			throw new Error("expected a declared column");
		}
		const sql = createSqlFor(result.builder);
		expect(sql).toContain('"col" integer not null');
		expect(sql).toContain("default nextval('app.orphan_seq'::regclass)");
		expect(sql).not.toContain("serial");
	});
});
