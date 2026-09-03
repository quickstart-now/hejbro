import type { HejbroInput, RenameSpec } from "../../../../src/index";
import {
	index,
	isNull,
	jsonb,
	op,
	sql,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";
import { app, docs, users } from "./declarations";

// Step 0: from empty — non-btree access methods (gin/brin/hash, #284 US1),
// per-column operator classes (jsonb_path_ops/gin_trgm_ops, #284 US2), and
// expression columns (#284 US3).

const fromEmpty: ReadonlyArray<HejbroInput> = [app, docs, users];

// Step 1: two definition changes under the same names (matches
// contracts/sql.md's own combined step-1 exactly):
// - docs_data_idx's opclass is dropped (jsonb_path_ops -> none), method
//   unchanged (gin) — #284 US2.
// - users_email_lower_idx's expression changes (lower(email) ->
//   lower(btrim(email))) — #284 US3. users_email_lower_uidx is untouched.

const docsOpclassChanged = table(
	app,
	"docs",
	{
		id: uuid().primaryKey().defaultRandom(),
		data: jsonb(),
		createdAt: timestamptz(),
		ownerId: uuid(),
		body: text(),
	},
	(t) => ({
		indexes: [
			index("docs_data_idx").using("gin").on(t.data),
			index("docs_created_at_idx").using("brin").on(t.createdAt),
			index("docs_owner_id_idx").using("hash").on(t.ownerId),
			index("docs_body_trgm_idx").using("gin").on(op(t.body, "gin_trgm_ops")),
		],
	}),
);

const usersExpressionChanged = table(
	app,
	"users",
	{
		id: uuid().primaryKey().defaultRandom(),
		email: text(),
		deletedAt: timestamptz(),
	},
	(t) => ({
		indexes: [
			index("users_email_lower_idx").on(sql`lower(btrim(${t.email}))`),
			index("users_email_lower_uidx")
				.unique()
				.on(sql`lower(${t.email})`)
				.where(isNull(t.deletedAt)),
		],
	}),
);

const definitionsChanged: ReadonlyArray<HejbroInput> = [
	app,
	docsOpclassChanged,
	usersExpressionChanged,
];

// Step 2: `--rename app.users.email=email_address` — the explicit name is
// kept (never derived); the expression is retargeted; no
// ambiguous-column-rename (#284 US3, T035).

const usersColumnRenamed = table(
	app,
	"users",
	{
		id: uuid().primaryKey().defaultRandom(),
		emailAddress: text(),
		deletedAt: timestamptz(),
	},
	(t) => ({
		indexes: [
			index("users_email_lower_idx").on(sql`lower(btrim(${t.emailAddress}))`),
			index("users_email_lower_uidx")
				.unique()
				.on(sql`lower(${t.emailAddress})`)
				.where(isNull(t.deletedAt)),
		],
	}),
);

const emailRenamed: RenameSpec = {
	target: "column",
	schemaName: "app",
	tableName: "users",
	oldName: "email",
	newName: "email_address",
};

const columnRenamed = {
	declarations: [
		app,
		docsOpclassChanged,
		usersColumnRenamed,
	] as ReadonlyArray<HejbroInput>,
	renames: [emailRenamed],
};

export const steps: ReadonlyArray<
	| ReadonlyArray<HejbroInput>
	| {
			readonly declarations: ReadonlyArray<HejbroInput>;
			readonly renames?: ReadonlyArray<RenameSpec>;
	  }
> = [fromEmpty, definitionsChanged, columnRenamed];
