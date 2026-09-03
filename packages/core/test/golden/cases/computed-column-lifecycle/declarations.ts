import { schema } from "../../../../src/index";

/** A stored computed column's lifecycle (D100): create, expression change (rebuild), generated -> plain (drop expression). Computed columns only -- no identity. */
export const app = schema("app");
