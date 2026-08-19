/** When a generated statement runs: alongside the main body, or deferred until after it (e.g. cross-table foreign keys). */
export const sqlStages = ["main", "deferred"] as const;

/** @see sqlStages */
export type SqlStage = (typeof sqlStages)[number];

/** A single SQL statement paired with the stage it must run in. */
export type SqlStatement = {
	readonly sql: string;
	readonly stage: SqlStage;
};

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
