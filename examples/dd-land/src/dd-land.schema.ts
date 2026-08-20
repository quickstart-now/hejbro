import {
	defineView,
	eq,
	grant,
	rls,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import {
	anonRole,
	authenticatedRole,
	authUid,
	authUsers,
	storageBucket,
} from "@hejbro/supabase";

/**
 * A reduced port of the dd.land blog schema (D44) — every Supabase preset
 * feature exercised once: an `authUsers` FK, an `authUid()` RLS policy, a
 * storage bucket, a role-preset grant, a deliberately RLS-less table (the
 * exposed-table-without-rls warning), and a view without
 * `securityInvoker` over an RLS-protected table (#66). The full dd.land
 * port stays Phase 7 (D44).
 */
export const ddland = schema("ddland");

export const profiles = table(
	ddland,
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

/** Deliberately declares no RLS — proves the exposed-table-without-rls warning (D40) once `ddlandTablesGrant` below grants `anon` select on this schema. */
export const drafts = table(ddland, "drafts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});

export const avatars = storageBucket("avatars", { public: true });

export const ddlandTablesGrant = grant(ddland).tables("select").to(anonRole);

/** No `securityInvoker` over the RLS-protected `profiles` table — proves the view-security-invoker warning (#66, D39). */
export const profilesPublic = defineView(
	ddland,
	"profiles_public",
	select(profiles),
);
