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
	inArray,
	rls,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "hejbro";

/**
 * Showcase: the Supabase preset (D55) on a generic schema — every preset
 * feature exercised once: an `authUsers` FK, an `authUid()` RLS policy, a
 * storage bucket, role-preset grants, a deliberately RLS-less table (the
 * exposed-table-without-rls warning, D40), and a view without
 * `securityInvoker` over an RLS-protected table (#66, D39). Four steps
 * (`step-1` … `step-4`) evolve it; this is step 4 — moves `storage_path`
 * off `attachments` and onto a new one-to-one `attachment_blobs` table,
 * and adds `attachments.archived_at` in the same step so the migration
 * also exercises the `--confirm-drop` path (D32 rule A needs a same-table
 * drop + add pair).
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
		sizeBytes: bigint().notNull(),
		contentType: text(),
		// unrelated to storage_path's move — added in the same step so the
		// chain exercises the --confirm-drop path (D32 rule A needs a
		// same-table drop + add pair).
		archivedAt: timestamptz(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.profileId],
				references: { table: profiles, columns: [profiles.id] },
				onDelete: "cascade",
				onUpdate: "cascade",
			},
		],
		checks: [
			check("attachments_size_bytes_positive", gt(t.sizeBytes, 0)),
			check(
				"attachments_content_type_allowed",
				inArray(t.contentType, ["image/png", "image/jpeg"]),
			),
		],
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

/** One-to-one with `attachments`: the FK column doubles as the primary key — carries `storage_path`, which used to hold directly on `attachments`. */
export const attachmentBlobs = table(
	app,
	"attachment_blobs",
	{
		attachmentId: uuid().primaryKey(),
		storagePath: text().notNull(),
		checksum: text().notNull(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.attachmentId],
				references: { table: attachments, columns: [attachments.id] },
				onDelete: "cascade",
			},
		],
		rls: rls.enabled({
			readOwn: rls
				.policy("attachment_blobs_read_own")
				.for("select")
				.to(authenticatedRole)
				.using(
					exists(
						select(attachments)
							.innerJoin(profiles, eq(profiles.id, attachments.profileId))
							.where(
								and(
									eq(attachments.id, t.attachmentId),
									eq(profiles.userId, authUid()),
								),
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
	allowedMimeTypes: ["image/png", "image/jpeg", "application/pdf"],
});

export const appTablesGrant = grant(app)
	.tables("select")
	.to(anonRole, authenticatedRole);
// one-shot grants only cover tables that exist when they run; default privileges cover the ones later migrations add — see #121
export const appDefaultTablesGrant = grant(app)
	.defaultPrivileges.tables("select")
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
	attachmentBlobs,
	drafts,
	attachmentsBucket,
	appTablesGrant,
	appDefaultTablesGrant,
	profilesPublic,
];
