/**
 * Set-operation result typing (add-set-operations, D103 decision 4):
 * the database rejects branches whose rows are not union-compatible, so
 * the type layer rejects them FIRST — mismatched key sets resolve the
 * whole result to `never`, which the combinator's parameter side uses to
 * poison the call (the `related()` excess-key precedent). On a match the
 * result takes the LEFT branch's keys (SQL's own naming rule); each
 * column is the union of the two branches' declared types (identical
 * declarations collapse by idempotence), so a column nullable in EITHER
 * branch is nullable in the result.
 */
type SameKeys<TLeft, TRight> = [keyof TLeft] extends [keyof TRight]
	? [keyof TRight] extends [keyof TLeft]
		? true
		: false
	: false;

export type SetOpResult<TLeft, TRight> = SameKeys<TLeft, TRight> extends true
	? { readonly [K in keyof TLeft]: TLeft[K] | TRight[K & keyof TRight] }
	: never;
