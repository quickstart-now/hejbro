import { captureDeclarationSite } from "../declaration-site";
import { throwHejbroError } from "../error";
import type { ColumnRefNode, Expr, ExprNode, TableRefNode } from "../expr/ast";
import { findExprScopeViolation, someExprNode } from "../expr/walk";
import type { Role } from "./role";

/** The Postgres commands a policy can be scoped to. */
export const policyCommands = [
	"select",
	"insert",
	"update",
	"delete",
	"all",
] as const;

/** @see policyCommands */
export type PolicyCommand = (typeof policyCommands)[number];

/**
 * A finished, not-yet-table-bound policy (chain output). The clause data
 * fields are named `usingExpr`/`withCheckExpr` — not `using`/`withCheck` —
 * so they can never collide with the chain methods of the same name that
 * `PolicyBothStage` attaches to a just-built `PolicyInput` (an update/all
 * policy that ends its chain after only one clause call must keep the
 * *other* clause `null`, not have it silently overwritten by a function).
 */
export type PolicyInput = {
	readonly policyInputKind: "policy";
	readonly policyName: string;
	readonly permissive: boolean;
	readonly command: PolicyCommand;
	readonly roles: ReadonlyArray<string>;
	readonly usingExpr: ExprNode | null;
	readonly withCheckExpr: ExprNode | null;
	readonly declaredAt: string | null;
};

/** `rls.enabled(...)` output, not yet bound to a table. */
export type RlsInput = {
	readonly rlsInputKind: "rls";
	readonly force: boolean;
	readonly policies: Readonly<Record<string, PolicyInput>>;
	readonly declaredAt: string | null;
};

/**
 * `Expr<"boolean"> | Expr<"unknown">` -- the same union `check()` (D50) and
 * partial-index `.where()` (D51) adopted so the `sql` template's
 * `Expr<"unknown">` result (which can't be narrowed to a family at compile
 * time) is usable directly, without a cast. #113 applies it here a third
 * time, not a new design.
 */
type PolicyCondition = Expr<"boolean"> | Expr<"unknown">;

type PolicyUsingStage = {
	using(condition: PolicyCondition): PolicyInput;
};

type PolicyCheckStage = {
	withCheck(condition: PolicyCondition): PolicyInput;
};

type PolicyBothStage = {
	using(condition: PolicyCondition): PolicyInput & PolicyCheckStage;
	withCheck(condition: PolicyCondition): PolicyInput & PolicyUsingStage;
};

type PolicyRolesStage<TStage> = {
	to(...roles: ReadonlyArray<string | Role>): TStage;
};

type PolicyPending = {
	as(kind: "permissive" | "restrictive"): PolicyPending;
	for(command: "select" | "delete"): PolicyRolesStage<PolicyUsingStage>;
	for(command: "insert"): PolicyRolesStage<PolicyCheckStage>;
	for(command: "update" | "all"): PolicyRolesStage<PolicyBothStage>;
};

type PendingState = {
	readonly policyName: string;
	readonly permissive: boolean;
	readonly declaredAt: string | null;
};

type ForState = PendingState & {
	readonly command: PolicyCommand;
};

type RolesState = ForState & {
	readonly roles: ReadonlyArray<string>;
};

const finishPolicy = (
	state: RolesState,
	usingExpr: ExprNode | null,
	withCheckExpr: ExprNode | null,
): PolicyInput => ({
	policyInputKind: "policy",
	policyName: state.policyName,
	permissive: state.permissive,
	command: state.command,
	roles: state.roles,
	usingExpr,
	withCheckExpr,
	declaredAt: state.declaredAt,
});

const buildUsingStage = (state: RolesState): PolicyUsingStage => ({
	using: (condition) => finishPolicy(state, condition.exprNode, null),
});

const buildCheckStage = (state: RolesState): PolicyCheckStage => ({
	withCheck: (condition) => finishPolicy(state, null, condition.exprNode),
});

const buildBothStage = (
	state: RolesState,
	using: ExprNode | null,
	withCheck: ExprNode | null,
): PolicyBothStage => ({
	using: (condition) => {
		const nextUsing = condition.exprNode;
		const built = finishPolicy(state, nextUsing, withCheck);
		return Object.assign(built, {
			withCheck: (checkCondition: PolicyCondition) =>
				finishPolicy(state, nextUsing, checkCondition.exprNode),
		});
	},
	withCheck: (condition) => {
		const nextWithCheck = condition.exprNode;
		const built = finishPolicy(state, using, nextWithCheck);
		return Object.assign(built, {
			using: (usingCondition: PolicyCondition) =>
				finishPolicy(state, usingCondition.exprNode, nextWithCheck),
		});
	},
});

const buildRolesStage = <TStage>(
	state: ForState,
	buildStage: (rolesState: RolesState) => TStage,
): PolicyRolesStage<TStage> => ({
	to: (...roles) => {
		if (roles.length === 0) {
			return throwHejbroError(
				"rls-policy-missing-roles",
				`policy "${state.policyName}" calls .to() with no roles — Postgres requires at least one role after TO. Next: pass .to("anon") or the specific roles this policy applies to.`,
				state.declaredAt,
			);
		}
		return buildStage({ ...state, roles });
	},
});

/**
 * `PolicyPending["for"]` is declared with three overload signatures so
 * illegal clause combinations don't type-check (D26); this single runtime
 * implementation branches on `command` and returns the matching stage,
 * which TypeScript can't trace back through an overloaded object property
 * — the one generic/runtime boundary crossing in this file (mirrors
 * `dsl/table.ts`'s `buildColumnRefs` cast).
 */
const buildFor = (state: PendingState): PolicyPending["for"] =>
	((command: PolicyCommand) => {
		const forState: ForState = { ...state, command };
		if (command === "select" || command === "delete") {
			return buildRolesStage(forState, buildUsingStage);
		}
		if (command === "insert") {
			return buildRolesStage(forState, buildCheckStage);
		}
		return buildRolesStage(forState, (rolesState) =>
			buildBothStage(rolesState, null, null),
		);
	}) as PolicyPending["for"];

const buildPending = (state: PendingState): PolicyPending => ({
	as: (kind) => buildPending({ ...state, permissive: kind === "permissive" }),
	for: buildFor(state),
});

/** Builder chain and table-attachment entry points for row-level security (D26). */
export const rls: {
	enabled(
		policies: Readonly<Record<string, PolicyInput>>,
		options?: { readonly force?: boolean },
	): RlsInput;
	policy(policyName: string): PolicyPending;
} = {
	enabled: (policies, options) => ({
		rlsInputKind: "rls",
		force: options?.force ?? false,
		policies,
		declaredAt: captureDeclarationSite(),
	}),
	policy: (policyName) =>
		buildPending({
			policyName,
			permissive: true,
			declaredAt: captureDeclarationSite(),
		}),
};

/** A `PolicyInput` bound to the table that declared it. */
export type PolicyDeclaration = {
	readonly declarationKind: "policy";
	readonly schemaName: string;
	readonly tableName: string;
	readonly policyName: string;
	readonly permissive: boolean;
	readonly command: PolicyCommand;
	readonly roles: ReadonlyArray<string>;
	readonly using: ExprNode | null;
	readonly withCheck: ExprNode | null;
	readonly declaredAt: string | null;
};

/** An `RlsInput` bound to the table that declared it. */
export type RlsDeclaration = {
	readonly declarationKind: "rls";
	readonly schemaName: string;
	readonly tableName: string;
	readonly force: boolean;
	readonly policies: ReadonlyArray<PolicyDeclaration>;
	readonly declaredAt: string | null;
};

const clauseNotAllowed = (
	policy: PolicyInput,
	clause: "using" | "with check",
	otherClause: "using" | "with check",
): never =>
	throwHejbroError(
		"rls-policy-clause-not-allowed",
		`policy "${policy.policyName}" is FOR ${policy.command} and cannot take ${clause} — Postgres rejects it. Next: use ${otherClause} instead.`,
		policy.declaredAt,
	);

/** `select`/`delete` policies take `using` only — Postgres rejects a `with check` on either (#154 ratchet-5: split out of assertClauseAllowed so each independent rule reads as its own guard). */
const assertWithCheckNotOnReadCommands = (policy: PolicyInput): void => {
	if (
		(policy.command === "select" || policy.command === "delete") &&
		policy.withCheckExpr !== null
	) {
		clauseNotAllowed(policy, "with check", "using");
	}
};

/** `insert` policies take `with check` only — Postgres rejects a `using` on it (#154 ratchet-5, see assertWithCheckNotOnReadCommands). */
const assertUsingNotOnInsert = (policy: PolicyInput): void => {
	if (policy.command === "insert" && policy.usingExpr !== null) {
		clauseNotAllowed(policy, "using", "with check");
	}
};

/** Defensive runtime guard for clause/command combinations the type-state chain (D26) already prevents — one independent rule per command/clause pair, see the two guards above. */
const assertClauseAllowed = (policy: PolicyInput): void => {
	assertWithCheckNotOnReadCommands(policy);
	assertUsingNotOnInsert(policy);
};

/**
 * Rejects a column reference outside the policy's own table — including
 * one buried inside an `exists()` subquery's own `where`/join `on`/
 * `orderBy`, which used to reach declaration time unrejected (#160):
 * {@link findExprScopeViolation} extends scope by the subquery's own
 * `from`/joins as it descends, exactly the rule `render-sql.ts`'s
 * `renderSelectClauses` applies when it actually renders one, so a
 * correlated reference to this policy's own table stays legal at any
 * depth and a reference to any *other* table is rejected wherever it
 * sits. `policyKind.serialize` (`kinds/policy-kind.ts`) used to run this
 * same check again at serialize time, via a `renderExpr` call whose
 * result it discarded — this declaration-time version is now complete,
 * so that redundant call is gone (#160).
 */
const assertOwnColumnsOnly = (
	schemaName: string,
	tableName: string,
	policy: PolicyInput,
): void => {
	const scope: ReadonlyArray<TableRefNode> = [{ schemaName, tableName }];
	const foreignRef = [policy.usingExpr, policy.withCheckExpr]
		.filter((expr): expr is ExprNode => expr !== null)
		.map((expr) => findExprScopeViolation(expr, scope))
		.find((ref): ref is ColumnRefNode => ref !== undefined);
	if (foreignRef !== undefined) {
		throwHejbroError(
			"rls-policy-foreign-column",
			`policy "${policy.policyName}" on "${schemaName}.${tableName}" references column "${foreignRef.schemaName}.${foreignRef.tableName}.${foreignRef.columnName}" — a policy expression (including inside exists()) may only reference its own table's columns, or, from inside exists(), that subquery's own table. Next: reach a different table through exists(), correlating back to "${schemaName}.${tableName}" rather than referencing a third table directly.`,
			policy.declaredAt,
		);
	}
};

/**
 * Rejects a policy `using`/`with check` expression containing a window
 * function (D104) — a new guard home (no site here rejected anything
 * about window functions before this). Uses the SHALLOW `someExprNode`,
 * matching `where`/`groupBy`/`having`'s own rule (`query/select.ts`) —
 * deliberately NOT `assertOwnColumnsOnly`'s deep, `exists()`-descending
 * walker right above: a window function inside an `exists()` subquery's
 * own select list is a different, legal query, and following the deep
 * precedent here would false-positive on it.
 */
const assertNoPolicyWindowFunction = (
	schemaName: string,
	tableName: string,
	policy: PolicyInput,
): void => {
	const windowed = [policy.usingExpr, policy.withCheckExpr]
		.filter((expr): expr is ExprNode => expr !== null)
		.find((expr) => someExprNode(expr, (node) => node.nodeKind === "window"));
	if (windowed !== undefined) {
		throwHejbroError(
			"rls-policy-window-function",
			`policy "${policy.policyName}" on "${schemaName}.${tableName}" contains a window function — Postgres forbids window functions in a policy's USING/WITH CHECK expression. Next: move the window function into a view the policy reads from instead, or restructure with a subquery.`,
			policy.declaredAt,
		);
	}
};

const bindPolicy = (
	schemaName: string,
	tableName: string,
	policy: PolicyInput,
): PolicyDeclaration => {
	assertClauseAllowed(policy);
	assertOwnColumnsOnly(schemaName, tableName, policy);
	assertNoPolicyWindowFunction(schemaName, tableName, policy);
	return {
		declarationKind: "policy",
		schemaName,
		tableName,
		policyName: policy.policyName,
		permissive: policy.permissive,
		command: policy.command,
		roles: policy.roles,
		using: policy.usingExpr,
		withCheck: policy.withCheckExpr,
		declaredAt: policy.declaredAt,
	};
};

const findDuplicatePolicyName = (
	entries: ReadonlyArray<readonly [string, PolicyInput]>,
): PolicyInput | undefined => {
	const names = entries.map(([, policy]) => policy.policyName);
	const duplicateName = names.find(
		(name, index) => names.indexOf(name) !== index,
	);
	return entries.find(([, policy]) => policy.policyName === duplicateName)?.[1];
};

const assertNoDuplicatePolicyNames = (
	tableName: string,
	entries: ReadonlyArray<readonly [string, PolicyInput]>,
): void => {
	const duplicate = findDuplicatePolicyName(entries);
	if (duplicate !== undefined) {
		throwHejbroError(
			"duplicate-policy-name",
			`table "${tableName}" declares two policies named "${duplicate.policyName}" — Postgres requires unique policy names per table. Next: rename one (the TS object key is just a label, the string passed to rls.policy() is the SQL name).`,
			duplicate.declaredAt,
		);
	}
};

/**
 * Binds an `RlsInput` to its owning table: stamps `schemaName`/`tableName`
 * onto every policy and validates the whole set (duplicate SQL policy
 * names, clause/command combinations, and own-table-only column
 * references).
 */
export const bindRls = (
	schemaName: string,
	tableName: string,
	input: RlsInput,
): RlsDeclaration => {
	const entries = Object.entries(input.policies);
	assertNoDuplicatePolicyNames(tableName, entries);
	const policies = entries.map(([, policy]) =>
		bindPolicy(schemaName, tableName, policy),
	);
	return {
		declarationKind: "rls",
		schemaName,
		tableName,
		force: input.force,
		policies,
		declaredAt: input.declaredAt,
	};
};
