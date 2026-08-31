import { quoteStringLiteral } from "@hejbro/core";
import type { CompileResult, ContextRendering, DbContext } from "@hejbro/query";

/**
 * The two `DbContext.settings` keys this preset's own builder/rendering
 * pair agree on (task 3.1/3.2, #565) -- the same strings double as the
 * session variable names the rendering's `SET LOCAL` statements name, so
 * there is exactly one place either would need to change.
 */
const TENANT_SETTING_KEY = "nile.tenant_id";
const USER_SETTING_KEY = "nile.user_id";

/** `{ [USER_SETTING_KEY]: userId }` when given a value, or `{}` when omitted -- avoids ever spreading an explicit key with an `undefined` value, mirroring `@hejbro/query`'s own per-field guard-clause helpers (`db/context.ts`'s `roleStatements`). */
const userSettingField = (
	userId: string | undefined,
): Record<string, string> => {
	if (userId === undefined) {
		return {};
	}
	return { [USER_SETTING_KEY]: userId };
};

/**
 * Builds a role-less {@link DbContext} naming a tenant, and optionally a
 * user (task 3.1, #565) -- role-less because this platform has none
 * (`nileDriver`'s own `roleLessPlatform` declaration admits it). Carries
 * no validation of its own: `tenantId`/`userId` are stored as given, and
 * {@link nileContextRendering} is the sole place either value is checked
 * (task 3.5's own scope) -- a `DbContext` can also be built by hand,
 * bypassing this builder entirely (`db.as({ settings: {...} })`), and the
 * spec's own safety requirement ("the driver -- not the query layer --
 * owns their safety") is on the rendering, not this constructor, so
 * duplicating the check here would be a second, driftable copy of it.
 */
export const asTenant = (tenantId: string, userId?: string): DbContext => ({
	settings: {
		[TENANT_SETTING_KEY]: tenantId,
		...userSettingField(userId),
	},
});

/** Canonical UUID: 8-4-4-4-12 hex digits, case-insensitive (task 3.5, #565) -- the platform's own value shape for both settings; no other format (URN prefix, braces) is accepted. */
const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Builds and throws the `nile-context-value-invalid`-coded, enriched plain `Error` (D57) -- a `function` declaration, not `const f = (): never => …` (handoff note, g2/g3). Never includes `value` itself in the message or the thrown object's own properties, so an adversarial value cannot ride along inside the error the way it must not ride along inside a rendered statement (task 3.5's "never appears as a substring" -- an uncaught error's own message is exactly the kind of place that could otherwise leak it). */
function throwInvalidNileContextValue(field: "tenant" | "user"): never {
	throw Object.assign(
		new Error(
			`Nile's "${field}" context value is not a canonical UUID (8-4-4-4-12 hex digits). Next: pass a valid UUID for this platform's ${field} setting, built by this platform (Nile assigns tenant/user ids as UUIDs).`,
		),
		{ code: "nile-context-value-invalid", field },
	);
}

/** Refuses `value` before it can reach a statement (task 3.5, #565) -- called from inside {@link nileContextRendering}'s own return expression, so a thrown error here aborts that expression's construction and nothing is ever returned to the query layer to send (spec: "before any statement is sent"). */
const validatedValue = (field: "tenant" | "user", value: string): string => {
	if (!CANONICAL_UUID.test(value)) {
		throwInvalidNileContextValue(field);
	}
	return value;
};

/** One `SET LOCAL key = 'value'` statement (tasks 3.2/3.4/3.6, #565) -- `SET LOCAL`, never session-scoped `SET` (task 3.4's "transaction-local by form") and never `set_config` (task 3.4's own requirement); the value is quoted through {@link quoteStringLiteral}, never raw-concatenated (task 3.6), since `SET LOCAL` takes no bind parameter (`params` is always empty here). */
const settingStatement = (key: string, value: string): CompileResult => ({
	sql: `set local ${key} = ${quoteStringLiteral(value)}`,
	params: [],
	kind: "sql",
});

/** `{ [USER_SETTING_KEY]: ... }`'s own rendering half -- empty when no user value was carried, one validated+quoted statement otherwise. Filter+map, never a ternary (house style), mirroring `@hejbro/query`'s own `roleStatements`. */
const userStatements = (
	userId: string | undefined,
): ReadonlyArray<CompileResult> =>
	[userId]
		.filter((value): value is string => value !== undefined)
		.map((value) =>
			settingStatement(USER_SETTING_KEY, validatedValue("user", value)),
		);

/**
 * The Nile preset's own driver-owned rendering contribution (tasks
 * 3.2-3.6, #565, spec: "The Nile preset renders a tenant context") --
 * the tenant setting first, unconditionally (a context this platform
 * accepts always names a tenant; a context.settings with no tenant key at
 * all fails the same UUID check an empty string would), the user setting
 * immediately after when one was named. Never `set_config` (task 3.4),
 * always `SET LOCAL` (transaction-local by form, task 3.4's other half),
 * always through {@link validatedValue}/{@link quoteStringLiteral} (tasks
 * 3.5/3.6) -- a pure mapping, never a side effect (the driver contract's
 * own `ContextRendering` requirement), wired onto `nileDriver`'s output
 * in `driver.ts` (task 3.2, lead-approved group-3 addition to that file).
 */
export const nileContextRendering: ContextRendering = (context) => [
	settingStatement(
		TENANT_SETTING_KEY,
		validatedValue("tenant", context.settings?.[TENANT_SETTING_KEY] ?? ""),
	),
	...userStatements(context.settings?.[USER_SETTING_KEY]),
];
