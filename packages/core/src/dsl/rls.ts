import { captureDeclarationSite } from "../declaration-site";
import { throwHejbroError } from "../error";
import type { Expr, ExprNode } from "../expr/ast";

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

/** A finished, not-yet-table-bound policy (chain output). */
export type PolicyInput = {
	readonly policyInputKind: "policy";
	readonly policyName: string;
	readonly permissive: boolean;
	readonly command: PolicyCommand;
	readonly roles: ReadonlyArray<string>;
	readonly using: ExprNode | null;
	readonly withCheck: ExprNode | null;
	readonly declaredAt: string | null;
};

/** `rls.enabled(...)` output, not yet bound to a table. */
export type RlsInput = {
	readonly rlsInputKind: "rls";
	readonly force: boolean;
	readonly policies: Readonly<Record<string, PolicyInput>>;
	readonly declaredAt: string | null;
};

type PolicyUsingStage = {
	using(condition: Expr<"boolean">): PolicyInput;
};

type PolicyCheckStage = {
	withCheck(condition: Expr<"boolean">): PolicyInput;
};

type PolicyBothStage = {
	using(condition: Expr<"boolean">): PolicyInput & PolicyCheckStage;
	withCheck(condition: Expr<"boolean">): PolicyInput & PolicyUsingStage;
};

type PolicyRolesStage<TStage> = {
	to(...roles: ReadonlyArray<string>): TStage;
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
	using: ExprNode | null,
	withCheck: ExprNode | null,
): PolicyInput => ({
	policyInputKind: "policy",
	policyName: state.policyName,
	permissive: state.permissive,
	command: state.command,
	roles: state.roles,
	using,
	withCheck,
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
			withCheck: (checkCondition: Expr<"boolean">) =>
				finishPolicy(state, nextUsing, checkCondition.exprNode),
		});
	},
	withCheck: (condition) => {
		const nextWithCheck = condition.exprNode;
		const built = finishPolicy(state, using, nextWithCheck);
		return Object.assign(built, {
			using: (usingCondition: Expr<"boolean">) =>
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
				`policy "${state.policyName}" calls .to() with no roles — Postgres requires at least one role after TO; pass .to("anon") or the specific roles this policy applies to.`,
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
