/**
 * When a generated statement runs: before the main body (dependent-object
 * drops that must clear before a `main`-stage alter touches what they
 * depend on — e.g. a view recreate's `drop view if exists`), alongside the
 * main body, or deferred until after it (e.g. cross-table foreign keys).
 */
export const sqlStages = ["predrop", "main", "deferred"] as const;

/** @see sqlStages */
export type SqlStage = (typeof sqlStages)[number];

/** A single SQL statement paired with the stage it must run in. */
export type SqlStatement = {
	readonly sql: string;
	readonly stage: SqlStage;
};

/**
 * Builds a predrop-stage {@link SqlStatement} — runs before every
 * `main`-stage statement, ordered by descending kind-dependency rank (a
 * dependent kind's predrop runs before the kind it depends on is altered).
 * For a same-identity recreate (drop+create for the same object, D23/#55)
 * the drop half goes through this and the create half through
 * {@link statement} — they stay one `KindChange`/one `emit()` call, just
 * split across stages.
 */
export const predropStatement = (sql: string): SqlStatement => ({
	sql,
	stage: "predrop",
});

/** Builds a main-stage {@link SqlStatement}. */
export const statement = (sql: string): SqlStatement => ({
	sql,
	stage: "main",
});

/** Builds a deferred-stage {@link SqlStatement} (runs after all main-stage statements). */
export const deferredStatement = (sql: string): SqlStatement => ({
	sql,
	stage: "deferred",
});
