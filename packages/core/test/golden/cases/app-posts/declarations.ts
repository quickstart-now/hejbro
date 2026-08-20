import { pgEnum, schema } from "../../../../src/index";

/** The original production schema (spec §5.1), ported as the Phase 1 acceptance case. */
export const app = schema("app");

/** Post publication status (spec §5.1's `posts` table, extended with an enum column for Phase 1 coverage). */
export const postStatus = pgEnum(app, "post_status", ["draft", "published"]);
