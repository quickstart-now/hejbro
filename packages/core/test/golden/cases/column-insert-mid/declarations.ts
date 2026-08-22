import { schema } from "../../../../src/index";

/** D81 acceptance case (#261): a table that gains a column mid-declaration across
 * migrations, exercised through a `returns: <table>` function and a view built on
 * `select(table)` — both must follow the table's physical column order, not
 * declaration order, once a parent snapshot exists. */
export const app = schema("app");
