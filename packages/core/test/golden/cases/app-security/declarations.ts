import {
	and,
	eq,
	exists,
	grant,
	isNull,
	lte,
	now,
	rls,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";

/**
 * The Phase 4 acceptance case (#65): the dd.land grants corpus plus a
 * representative slice of its legacy RLS policies, all in one migration.
 *
 * **Grants — 1:1 port of `quickstart-labs/infra/dd-land-supabase/sql/grants.ts`**
 * (read directly for this port), which is `anon`/`service_role`'s entire
 * privilege surface for the `ddland` schema:
 *
 * ```sql
 * grant usage on schema ddland to anon, service_role;
 * grant select on all tables in schema ddland to anon;
 * grant select, insert, update, delete on all tables in schema ddland to service_role;
 * alter default privileges in schema ddland grant select on tables to anon;
 * alter default privileges in schema ddland
 *   grant select, insert, update, delete on tables to service_role;
 * ```
 *
 * One intentional divergence: hejbro's `to(...roles)` fans out into one
 * declaration — and one emitted statement — per role (D28), so the first
 * statement above (`to anon, service_role`) becomes two `grant usage`
 * statements below instead of one grouped statement. Semantically
 * equivalent; Postgres doesn't distinguish the two forms.
 *
 * **RLS — ported from the legacy dd.land migrations** (A6: current
 * production dd.land is grants-only — see the Phase 4 brainstorm notes —
 * so this is the only real RLS source available for the port; both files
 * read directly for this port):
 * - `posts_read_published` and `post_translations_read_published` —
 *   `legacy/migrations/20260812090000_create_reading_schema.sql:86-97`.
 * - `comments_read_visible` —
 *   `legacy/migrations/20260813020000_create_comments_and_reactions.sql:130-140`.
 *
 * `post_translations` is modeled with a synthetic `id` primary key here
 * (the legacy table has no single-column key — its PK is the composite
 * `(post_id, locale)`, which core doesn't yet represent) — a schema
 * simplification that doesn't affect the ported RLS clause itself.
 *
 * Plus one insert/`with check` policy, `posts_insert_draft_only`, shaped
 * after `infra/planner-supabase/supabase/migrations/20260702052212_dogfood_probe_scope_gate.sql`
 * (`for insert to <role> with check (<condition>)`) but expressed with
 * core operators only — the original's `auth.jwt()->>'scope'` check is
 * Supabase-preset territory (Phase 6, #66), not available in core yet.
 */
export const ddland = schema("ddland");

export const posts = table(
	ddland,
	"posts",
	{
		id: uuid().primaryKey().defaultRandom(),
		status: text().notNull(),
		publishedAt: timestamptz(),
	},
	(t) => ({
		rls: rls.enabled({
			readPublished: rls
				.policy("posts_read_published")
				.for("select")
				.to("anon")
				.using(and(eq(t.status, "published"), lte(t.publishedAt, now()))),
			insertDraftOnly: rls
				.policy("posts_insert_draft_only")
				.for("insert")
				.to("authenticated")
				.withCheck(eq(t.status, "draft")),
		}),
	}),
);

export const postTranslations = table(
	ddland,
	"post_translations",
	{
		id: uuid().primaryKey().defaultRandom(),
		postId: uuid().notNull(),
		locale: text().notNull(),
	},
	(t) => ({
		rls: rls.enabled({
			readPublished: rls
				.policy("post_translations_read_published")
				.for("select")
				.to("anon")
				.using(
					exists(
						select(posts).where(
							and(
								eq(posts.id, t.postId),
								eq(posts.status, "published"),
								lte(posts.publishedAt, now()),
							),
						),
					),
				),
		}),
	}),
);

export const comments = table(
	ddland,
	"comments",
	{
		id: uuid().primaryKey().defaultRandom(),
		postId: uuid().notNull(),
		deletedAt: timestamptz(),
	},
	(t) => ({
		rls: rls.enabled({
			readVisible: rls
				.policy("comments_read_visible")
				.for("select")
				.to("anon")
				.using(
					and(
						isNull(t.deletedAt),
						exists(
							select(posts).where(
								and(
									eq(posts.id, t.postId),
									eq(posts.status, "published"),
									lte(posts.publishedAt, now()),
								),
							),
						),
					),
				),
		}),
	}),
);

export const usageGrants = grant(ddland).usage.to("anon", "service_role");

export const anonSelectGrant = grant(ddland).tables("select").to("anon");

export const serviceRoleFullGrant = grant(ddland)
	.tables("select", "insert", "update", "delete")
	.to("service_role");

export const anonDefaultSelectGrant = grant(ddland)
	.defaultPrivileges.tables("select")
	.to("anon");

export const serviceRoleDefaultGrant = grant(ddland)
	.defaultPrivileges.tables("select", "insert", "update", "delete")
	.to("service_role");
