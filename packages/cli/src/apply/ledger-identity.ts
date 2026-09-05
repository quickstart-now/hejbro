import { throwHejbroError } from "@hejbro/core";
import type { CompileResult, Driver, DriverRow } from "@hejbro/query";
import { LEDGER_SCHEMA, LEDGER_TABLE } from "./ledger";
import { throwLedgerReadFailure } from "./ledger-diagnostics";

/**
 * [design.md, 783/R2] What sits at hejbro's own ledger name -- read once,
 * by identity, never by existence alone. `absent`: no relation. `ledger`:
 * hejbro's own bootstrapped table. `occupied`: a relation is there but it
 * is not the ledger -- `relation` is the kind word a caller's diagnostic
 * names, `columns` the attribute names the catalog read found (empty for
 * a zero-column table).
 *
 * [1.6, 631/R14] `filtered`: the relation has the ledger's own shape, but
 * row-level security is on -- hejbro never enables it on its own ledger,
 * so this is a ledger someone else changed, not a different one. `state`
 * names which of `relrowsecurity`/`relforcerowsecurity` the catalog
 * reported; `role`/`policies` come from a second statement, sent only for
 * this case (R14(b)/(c)).
 */
export type LedgerIdentity =
	| { readonly kind: "absent" }
	| { readonly kind: "ledger" }
	| {
			readonly kind: "occupied";
			readonly relation: string;
			readonly columns: ReadonlyArray<string>;
	  }
	| {
			readonly kind: "filtered";
			readonly state: "enabled" | "forced" | "enabled and forced";
			readonly role: string;
			readonly policies: ReadonlyArray<string>;
	  };

/**
 * The four columns `ledger.ts`'s `bootstrapLedger` creates, each under the
 * `format_type` spelling Postgres itself reports back (measured on
 * `postgres:17-alpine`) -- the identity `probeLedgerIdentity` checks a
 * candidate table against, never a second, hand-derived list.
 */
const BOOTSTRAP_COLUMNS: Readonly<Record<string, string>> = {
	id: "bigint",
	filename: "text",
	origin: "text",
	// biome-ignore lint/style/useNamingConvention: Postgres's own bootstrapped column name
	applied_at: "timestamp with time zone",
};

/** [design.md, 783/R2; 2.1, review repair of 51c0d7d5] `relkind` letter to the word a diagnostic names -- every relation kind PostgreSQL 17 has, so the fallback below is reached only by a letter a later Postgres version adds. */
const RELATION_WORDS: Readonly<Record<string, string>> = {
	r: "table",
	p: "partitioned table",
	v: "view",
	m: "materialized view",
	f: "foreign table",
	c: "composite type",
	i: "index",
	// biome-ignore lint/style/useNamingConvention: Postgres's own relkind letter
	I: "partitioned index",
	t: "TOAST table",
	// biome-ignore lint/style/useNamingConvention: Postgres's own relkind letter
	S: "sequence",
};

/** [2.1, 783/R5] Relation kinds whose `(columns: …)` clause says something a user can act on -- a sequence's or an index's own catalog columns are internal machinery, not a schema. Matched against {@link relationWord}'s output after stripping any `"unlogged "` prefix (783/R5 2.2) -- an unlogged table is still a table for this purpose. */
const COLUMN_BEARING_WORDS = new Set([
	"table",
	"leaf partition",
	"inheritance child",
	"relation of a kind this version does not name",
	"partitioned table",
	"view",
	"materialized view",
	"foreign table",
	"composite type",
]);

/** [783/R5, 2.2] `"unlogged "` when `relpersistence = 'u'`, `""` otherwise -- prefixed onto whatever the relkind's own word is, never special-cased to `relkind = 'r'` alone: a partitioned table, a sequence (PG15+) and an index (inheriting its table's persistence) can all be unlogged too. */
const persistencePrefix = (persistence: string): string => {
	if (persistence === "u") {
		return "unlogged ";
	}
	return "";
};

/** D106 round 1 NB2: the requirement says "never the catalog's own one-letter code" without exception, so even the fallback for a relkind this version does not map carries no letter. */
const UNMAPPED_KIND_WORD = "relation of a kind this version does not name";

/** D106 round 1 NB1: a leaf partition and an inheritance child are `relkind = 'r'` in the catalog, yet hejbro never creates either -- their own word wins over the relkind's so the refusal says what actually sits there. Only for `relkind = 'r'`: a partitioned table that is itself a partition (a middle level of a partition tree) keeps its own word, it is no leaf. */
const lineageWord = (
	relkind: string,
	partition: boolean,
	inherited: boolean,
): string | null => {
	if (relkind !== "r") {
		return null;
	}
	if (partition) {
		return "leaf partition";
	}
	if (inherited) {
		return "inheritance child";
	}
	return null;
};

const relationWord = (
	relkind: string,
	persistence: string,
	partition: boolean,
	inherited: boolean,
): string =>
	`${persistencePrefix(persistence)}${lineageWord(relkind, partition, inherited) ?? RELATION_WORDS[relkind] ?? UNMAPPED_KIND_WORD}`;

const UNLOGGED_PREFIX = "unlogged ";

/** Strips {@link UNLOGGED_PREFIX} before a {@link COLUMN_BEARING_WORDS} lookup -- "unlogged table" carries columns exactly as "table" does; the prefix names persistence, never a different kind. */
const withoutPersistencePrefix = (relation: string): string => {
	if (relation.startsWith(UNLOGGED_PREFIX)) {
		return relation.slice(UNLOGGED_PREFIX.length);
	}
	return relation;
};

/**
 * [design.md, 783/R2] Never `information_schema` (role-dependent) and
 * never `to_regclass` (answers non-null for every relation kind,
 * measured) -- one statement over the catalog itself, no transaction,
 * schema/table spelled once through `ledger.ts`'s own exported constants.
 * `relpersistence` (783/R5) travels beside `relkind` -- both are
 * properties of the relation itself, so every attribute row carries the
 * identical pair.
 */
const PROBE_SQL = `select c.relkind as "relkind", c.relpersistence as "persistence", c.relispartition as "partition", exists (select 1 from pg_inherits i where i.inhrelid = c.oid) as "inherited", c.relrowsecurity as "rls", c.relforcerowsecurity as "forcedRls", a.attname as "name", format_type(a.atttypid, a.atttypmod) as "type" from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where n.nspname = '${LEDGER_SCHEMA}' and c.relname = '${LEDGER_TABLE}' order by a.attnum`;

/**
 * [1.6, 631/R14] Sent only when the probe reports row-level security --
 * `(select 1)` on the left guarantees exactly one row per policy and one
 * row with `policy: null` when there is none, the same left-join shape
 * `PROBE_SQL` already uses to keep the relation's own row when it has no
 * columns (never an aggregate: a text-mode driver can hand an array back
 * as a string, and a quoted policy name can itself contain a comma).
 */
const POLICY_SQL = `select current_user as "role", p.policyname as "policy" from (select 1) as one left join pg_policies p on p.schemaname = '${LEDGER_SCHEMA}' and p.tablename = '${LEDGER_TABLE}'`;

/** A boolean column as node-postgres hands it back (`true`) and as a text-mode driver might (`"t"`); anything else, including an absent column, reads false. */
const isTrue = (value: unknown): boolean => value === true || value === "t";

/** A relation with zero columns still comes back as one `pg_class` row, its attribute columns null from the left join -- filtered out here rather than counted as a found column. */
const isColumnRow = (
	row: DriverRow,
): row is DriverRow & { readonly name: string; readonly type: string } =>
	row.name !== null && row.name !== undefined;

/** [783/R5, D106 round 1 NB1] `ledger` requires `relkind = 'r'`, `relpersistence = 'p'` (logged), no `relispartition` and no `pg_inherits` parent -- an unlogged table's rows vanish on a crash, and a partition or an inheritance child is a table hejbro never created, so none of them can hold the record of what was applied. */
const isLedgerShape = (
	relkind: string,
	persistence: string,
	partition: boolean,
	inherited: boolean,
	columnTypes: ReadonlyMap<string, string>,
): boolean =>
	relkind === "r" &&
	persistence === "p" &&
	!partition &&
	!inherited &&
	Object.entries(BOOTSTRAP_COLUMNS).every(
		([name, type]) => columnTypes.get(name) === type,
	);

/**
 * [task 1.8, harden-ledger-diagnostics, design.md D8] Sends {@link PROBE_SQL}
 * and, on failure, classifies it as `apply-ledger-unreadable` with the
 * probe's own opening clause -- never tagged (this statement never runs
 * through `ledger.ts`'s `exec`), so `throwLedgerReadFailure` reads the
 * raw driver error straight off its own fallback (`tag?.cause ?? failure`).
 */
const probeRows = async (
	driver: Driver,
	commandName: string,
): Promise<ReadonlyArray<DriverRow>> => {
	try {
		return await driver.execute({
			sql: PROBE_SQL,
			params: [],
			kind: "sql",
		} satisfies CompileResult);
	} catch (error) {
		await throwLedgerReadFailure(driver, error, commandName, "probe");
		throw error;
	}
};

/** [1.6, 631/R14] `null` for neither flag (never called then), `"enabled"`/`"forced"`/`"enabled and forced"` otherwise -- the exact three words {@link assertLedgerNotOccupied}'s message names. */
const rlsState = (
	rls: boolean,
	forcedRls: boolean,
): "enabled" | "forced" | "enabled and forced" | null => {
	if (rls && forcedRls) {
		return "enabled and forced";
	}
	if (rls) {
		return "enabled";
	}
	if (forcedRls) {
		return "forced";
	}
	return null;
};

/** [1.6, 631/R14] `false` for the one row {@link POLICY_SQL}'s left join answers when the ledger carries no policy at all -- `policy` is null there, the same convention {@link isColumnRow} already uses for a zero-column relation. */
const isPolicyRow = (
	row: DriverRow,
): row is DriverRow & { readonly policy: string } =>
	row.policy !== null && row.policy !== undefined;

/**
 * [1.6, 631/R14] Sent only when {@link probeLedgerIdentity} finds RLS on a
 * ledger-shaped relation -- classified through the same
 * `apply-ledger-unreadable` path as {@link probeRows}'s own failure,
 * since this statement judges the same identity, never the ledger table.
 */
const readPolicies = async (
	driver: Driver,
	commandName: string,
): Promise<{
	readonly role: string;
	readonly policies: ReadonlyArray<string>;
}> => {
	try {
		const rows = await driver.execute({
			sql: POLICY_SQL,
			params: [],
			kind: "sql",
		} satisfies CompileResult);
		return {
			role: String(rows[0]?.role),
			policies: rows.filter(isPolicyRow).map((row) => row.policy),
		};
	} catch (error) {
		await throwLedgerReadFailure(driver, error, commandName, "probe");
		throw error;
	}
};

/**
 * [design.md, 783/R2] `migrate`, `status`, `reset` and `raise` each call
 * this once, before any other read or write of the ledger -- the one
 * judgement they share, so the same relation is never called the ledger
 * by one command and something else by another.
 *
 * [task 1.8, harden-ledger-diagnostics, design.md D8] This statement
 * never runs through `ledger.ts`'s own `exec` (it reads the catalog, not
 * the ledger table), so a failure here is never tagged -- caught and
 * classified directly, the same `apply-ledger-unreadable` code the
 * ledger's own read failures take, but with the probe's own opening
 * clause ("the catalog read that judges ... was refused") naming what
 * was actually refused: the judgement, not the ledger.
 */
export const probeLedgerIdentity = async (
	driver: Driver,
	commandName: string,
): Promise<LedgerIdentity> => {
	const rows = await probeRows(driver, commandName);
	if (rows.length === 0) {
		return { kind: "absent" };
	}
	const relkind = String(rows[0]?.relkind);
	const persistence = String(rows[0]?.persistence);
	const partition = isTrue(rows[0]?.partition);
	const inherited = isTrue(rows[0]?.inherited);
	const columnRows = rows.filter(isColumnRow);
	const columns = columnRows.map((row) => String(row.name));
	const columnTypes = new Map(
		columnRows.map((row) => [String(row.name), String(row.type)]),
	);
	// [1.6, 631/R14(e)] The shape judgement wins: a relation that is not
	// the ledger's shape is `occupied` regardless of its RLS flags -- the
	// filtered judgement only ever applies to a relation this probe has
	// already found to be the ledger.
	if (!isLedgerShape(relkind, persistence, partition, inherited, columnTypes)) {
		return {
			kind: "occupied",
			relation: relationWord(relkind, persistence, partition, inherited),
			columns,
		};
	}
	const state = rlsState(isTrue(rows[0]?.rls), isTrue(rows[0]?.forcedRls));
	if (state === null) {
		return { kind: "ledger" };
	}
	const { role, policies } = await readPolicies(driver, commandName);
	return { kind: "filtered", state, role, policies };
};

/** [2.1, 783/R5] `null` when `relation`'s kind carries no columns worth naming (a sequence, an index, a partitioned index, a TOAST table) -- the clause is omitted entirely, never rendered empty. `"no columns"` is reserved for a column-bearing kind that happens to have none (a zero-column table). */
const columnsClause = (
	relation: string,
	columns: ReadonlyArray<string>,
): string | null => {
	if (!COLUMN_BEARING_WORDS.has(withoutPersistencePrefix(relation))) {
		return null;
	}
	if (columns.length === 0) {
		return "no columns";
	}
	return `columns: ${columns.join(", ")}`;
};

/** `" (columns: …)"`/`" (no columns)"`, or `""` when {@link columnsClause} omits the clause -- the leading space and parentheses live here, not at each call site. */
const columnsSuffix = (
	relation: string,
	columns: ReadonlyArray<string>,
): string => {
	const clause = columnsClause(relation, columns);
	if (clause === null) {
		return "";
	}
	return ` (${clause})`;
};

/** [2.3, review repair of 8f44e927] `"an"` before a vowel-initial word, `"a"` otherwise -- the closed set of relation words this module ever produces (`table`, `index`, `unlogged table`, `TOAST table`, …) never needs anything more than the first-letter rule. */
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

const article = (word: string): string => {
	const firstLetter = word.charAt(0).toLowerCase();
	if (VOWELS.has(firstLetter)) {
		return "an";
	}
	return "a";
};

/** [1.6, 631/R14(d); wording corrected 631/R15 N3] The default-deny sentence when the catalog held no policy at all, or the quoted, comma-joined list otherwise -- row-level security with no policy hides every row from an ordinary role, but not from the table's owner or a role carrying `BYPASSRLS`, so the sentence says "may", never a flat claim this catalog-only judgement can't back. */
const filteredPoliciesClause = (policies: ReadonlyArray<string>): string => {
	if (policies.length === 0) {
		return "it carries no policy at all, so every row may be hidden from that role";
	}
	return `the policies on it are ${policies.map((policy) => `"${policy}"`).join(", ")}`;
};

/**
 * [design.md, 783/R3] Refuses with `apply-ledger-occupied` when `identity`
 * is `occupied`, `apply-ledger-filtered` (1.6, 631/R14) when it is
 * `filtered`; a no-op for `absent`/`ledger` -- every one of the four
 * ledger-touching commands calls this right after {@link probeLedgerIdentity},
 * before any other read or write of the ledger, so an occupied or
 * filtered ledger is refused the same way regardless of which command
 * found it.
 *
 * [631/R14(a)] This function now throws two codes, not one -- its name
 * still names only the first. A rename touches all four call sites
 * (`migrate`, `status`, `raise`, and `reset`, the last outside this
 * piece), so it is a separate piece, not folded into this one.
 */
export const assertLedgerNotOccupied = (
	identity: LedgerIdentity,
	commandName: string,
): void => {
	if (identity.kind === "filtered") {
		throwHejbroError(
			"apply-ledger-filtered",
			`"${LEDGER_SCHEMA}"."${LEDGER_TABLE}" has row-level security ${identity.state}, and hejbro never turns it on for its own ledger. Rows this role cannot see read as a ledger that recorded nothing, and the next \`migrate\` would re-apply the chain from the start. The connecting role is "${identity.role}"; ${filteredPoliciesClause(identity.policies)}. Next: disable row-level security on the ledger, or connect as the role that applied the chain, then rerun \`${commandName}\`.`,
		);
	}
	if (identity.kind !== "occupied") {
		return;
	}
	throwHejbroError(
		"apply-ledger-occupied",
		`"${LEDGER_SCHEMA}"."${LEDGER_TABLE}" is held by ${article(identity.relation)} ${identity.relation} that is not hejbro's ledger${columnsSuffix(identity.relation, identity.columns)}. hejbro reads, writes and clears only the ledger it created, so this database is not one hejbro has applied to. Next: move or drop that ${identity.relation} yourself (hejbro will not touch it), or point --url at the database hejbro manages, then rerun \`${commandName}\`.`,
	);
};
