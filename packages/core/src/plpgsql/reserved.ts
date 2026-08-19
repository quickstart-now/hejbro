import { throwHejbroError } from "../error";

/**
 * PL/pgSQL + SQL reserved words that break unquoted locals. plpgsql locals
 * (row scalars, function args, `new`/`old` and their fields) render
 * unquoted (dual quoting policy, spec §5.3 decision A3) — a reserved word
 * here would collide with the keyword and produce invalid SQL.
 */
export const reservedPlpgsqlNames: ReadonlySet<string> = new Set([
	"all",
	"and",
	"any",
	"array",
	"as",
	"asc",
	"asymmetric",
	"begin",
	"between",
	"both",
	"by",
	"case",
	"cast",
	"check",
	"collate",
	"column",
	"constraint",
	"create",
	"current_date",
	"current_role",
	"current_time",
	"current_timestamp",
	"current_user",
	"declare",
	"default",
	"deferrable",
	"desc",
	"distinct",
	"do",
	"else",
	"end",
	"exception",
	"execute",
	"exists",
	"false",
	"fetch",
	"for",
	"foreach",
	"foreign",
	"from",
	"get",
	"grant",
	"group",
	"having",
	"if",
	"in",
	"initially",
	"intersect",
	"into",
	"leading",
	"limit",
	"localtime",
	"localtimestamp",
	"loop",
	"new",
	"not",
	"null",
	"offset",
	"old",
	"on",
	"only",
	"or",
	"order",
	"perform",
	"placing",
	"primary",
	"raise",
	"references",
	"return",
	"returning",
	"select",
	"session_user",
	"some",
	"strict",
	"symmetric",
	"table",
	"then",
	"to",
	"trailing",
	"true",
	"union",
	"unique",
	"user",
	"using",
	"variadic",
	"when",
	"where",
	"while",
	"window",
	"with",
]);

/**
 * Throws `reserved-local-name` if `name` collides with a plpgsql/SQL
 * reserved word. `declaredAt` is accepted now (unused) so the call sites
 * are ready for Task 3's determinism guard, which wires `declaredAt` into
 * `throwHejbroError` once `error.ts` grows the optional third parameter.
 */
export const assertValidLocalName = (
	name: string,
	identity: string,
	_declaredAt: string | null,
): void => {
	if (reservedPlpgsqlNames.has(name)) {
		throwHejbroError(
			"reserved-local-name",
			`local name "${name}" in ${identity} collides with a plpgsql/SQL reserved word — rename it (reserved words cannot be used unquoted in a function body).`,
		);
	}
};
