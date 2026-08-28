import { schema } from "../../../../src/index";

/** add-generated-columns task 2.2-a/2.4 (D100) acceptance case: a stored computed column's own lifecycle -- create, expression change (rebuild), and generated -> plain (drop expression, in place). Identity is deliberately absent here (a held, separate lead decision); this case is computed-columns-only. */
export const app = schema("app");
