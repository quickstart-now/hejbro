import {
	anonRole,
	authenticatedRole,
	authUid,
	authUsers,
	storageBucket,
} from "@hejbro/supabase";
import type { HejbroInput } from "hejbro";
import {
	and,
	bigint,
	check,
	defineView,
	eq,
	exists,
	grant,
	gt,
	rls,
	schema,
	select,
	table,
	text,
	uuid,
} from "hejbro";

/**
 * Showcase: the Supabase preset (D55) on a generic schema — every preset
 * feature exercised once: an `authUsers` FK, an `authUid()` RLS policy, a
 * storage bucket, role-preset grants, a deliberately RLS-less table (the
 * exposed-table-without-rls warning, D40), and a view without
 * `securityInvoker` over an RLS-protected table (#66, D39). Four steps
 * (`step-1` … `step-4`) evolve it; this is step 1.
 */
export const app = schema("app");

export const profiles = table(
	app,
	"profiles",
	{
		id: uuid().primaryKey().defaultRandom(),
		userId: uuid().notNull(),
		displayName: text().notNull(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.userId],
				references: { table: authUsers, columns: [authUsers.id] },
			},
		],
		rls: rls.enabled({
			readOwn: rls
				.policy("profiles_read_own")
				.for("select")
				.to(authenticatedRole)
				.using(eq(t.userId, authUid())),
		}),
	}),
);

export const attachments = table(
	app,
	"attachments",
	{
		id: uuid().primaryKey().defaultRandom(),
		profileId: uuid().notNull(),
		storagePath: text().notNull(),
		sizeBytes: bigint().notNull(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.profileId],
				references: { table: profiles, columns: [profiles.id] },
			},
		],
		checks: [check("attachments_size_bytes_positive", gt(t.sizeBytes, 0))],
		rls: rls.enabled({
			readOwn: rls
				.policy("attachments_read_own")
				.for("select")
				.to(authenticatedRole)
				.using(
					exists(
						select(profiles).where(
							and(eq(profiles.id, t.profileId), eq(profiles.userId, authUid())),
						),
					),
				),
		}),
	}),
);

/** Deliberately declares no RLS — proves the exposed-table-without-rls warning (D40) once the schema-wide grant below reaches it. */
export const drafts = table(app, "drafts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});

export const attachmentsBucket = storageBucket("attachments", {
	public: false,
	fileSizeLimit: 10_485_760,
	allowedMimeTypes: ["image/png", "image/jpeg"],
});

export const appTablesGrant = grant(app)
	.tables("select")
	.to(anonRole, authenticatedRole);

/** No `securityInvoker` over the RLS-protected `profiles` table — proves the view-security-invoker warning (#66, D39). */
export const profilesPublic = defineView(
	app,
	"profiles_public",
	select(profiles),
);

export const declarations: ReadonlyArray<HejbroInput> = [
	app,
	profiles,
	attachments,
	drafts,
	attachmentsBucket,
	appTablesGrant,
	profilesPublic,
];
