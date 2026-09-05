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
 */
export type LedgerIdentity =
	| { readonly kind: "absent" }
	| { readonly kind: "ledger" }
	| {
			readonly kind: "occupied";
			readonly relation: string;
			readonly columns: ReadonlyArray<string>;
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
const PROBE_SQL = `select c.relkind as "relkind", c.relpersistence as "persistence", c.relispartition as "partition", exists (select 1 from pg_inherits i where i.inhrelid = c.oid) as "inherited", a.attname as "name", format_type(a.atttypid, a.atttypmod) as "type" from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where n.nspname = '${LEDGER_SCHEMA}' and c.relname = '${LEDGER_TABLE}' order by a.attnum`;

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
	if (isLedgerShape(relkind, persistence, partition, inherited, columnTypes)) {
		return { kind: "ledger" };
	}
	return {
		kind: "occupied",
		relation: relationWord(relkind, persistence, partition, inherited),
		columns,
	};
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

/**
 * [design.md, 783/R3] Refuses with `apply-ledger-occupied` when `identity`
 * is `occupied`; a no-op for `absent`/`ledger` -- every one of the four
 * ledger-touching commands calls this right after {@link probeLedgerIdentity},
 * before any other read or write of the ledger, so an occupied name is
 * refused the same way regardless of which command found it.
 */
export const assertLedgerNotOccupied = (
	identity: LedgerIdentity,
	commandName: string,
): void => {
	if (identity.kind !== "occupied") {
		return;
	}
	throwHejbroError(
		"apply-ledger-occupied",
		`"${LEDGER_SCHEMA}"."${LEDGER_TABLE}" is held by ${article(identity.relation)} ${identity.relation} that is not hejbro's ledger${columnsSuffix(identity.relation, identity.columns)}. hejbro reads, writes and clears only the ledger it created, so this database is not one hejbro has applied to. Next: move or drop that ${identity.relation} yourself (hejbro will not touch it), or point --url at the database hejbro manages, then rerun \`${commandName}\`.`,
	);
};
