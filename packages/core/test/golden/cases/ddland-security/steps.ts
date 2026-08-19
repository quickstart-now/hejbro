import type { HejbroInput } from "../../../../src/index";
import {
	eq,
	grant,
	rls,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";
import {
	anonDefaultSelectGrant,
	anonSelectGrant,
	comments,
	ddland,
	posts,
	postTranslations,
	serviceRoleDefaultGrant,
	serviceRoleFullGrant,
	usageGrants,
} from "./declarations";

// Step 0: the full corpus from empty — tables, rls, policies, and grants.

const fromEmpty: ReadonlyArray<HejbroInput> = [
	ddland,
	posts,
	postTranslations,
	comments,
	usageGrants,
	anonSelectGrant,
	serviceRoleFullGrant,
	anonDefaultSelectGrant,
	serviceRoleDefaultGrant,
];

// Step 1: one policy expression change (posts_read_published drops the
// `published_at <= now()` conjunct — recreate pair) plus one privilege
// delta (anon gains insert on all tables — a single alter) in the same
// migration. Proves the banner lists both an object-kind recreate and an
// unrelated privilege-set delta together.

const postsPolicyChanged = table(
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
				.using(eq(t.status, "published")),
			insertDraftOnly: rls
				.policy("posts_insert_draft_only")
				.for("insert")
				.to("authenticated")
				.withCheck(eq(t.status, "draft")),
		}),
	}),
);

const anonGainsInsert = grant(ddland).tables("select", "insert").to("anon");

const policyChangeAndPrivilegeDelta: ReadonlyArray<HejbroInput> = [
	ddland,
	postsPolicyChanged,
	postTranslations,
	comments,
	usageGrants,
	anonGainsInsert,
	serviceRoleFullGrant,
	anonDefaultSelectGrant,
	serviceRoleDefaultGrant,
];

// Step 2: the posts_insert_draft_only policy is dropped (posts keeps only
// its read policy), and the service_role default-privileges grant
// declaration is removed entirely (revoke).

const postsInsertPolicyDropped = table(
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
				.using(eq(t.status, "published")),
		}),
	}),
);

const policyDropAndGrantRemoved: ReadonlyArray<HejbroInput> = [
	ddland,
	postsInsertPolicyDropped,
	postTranslations,
	comments,
	usageGrants,
	anonGainsInsert,
	serviceRoleFullGrant,
	anonDefaultSelectGrant,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	policyChangeAndPrivilegeDelta,
	policyDropAndGrantRemoved,
];
