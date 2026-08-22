import { existingTable, text, uuid } from "@hejbro/core";

/**
 * A reference-only `auth.users` (D41): the columns hejbro users actually
 * target — `id` (the FK anchor for `public → auth.users(id)` references,
 * the single most common Supabase pattern) and `email`. Extend as real
 * usage demands; like every `existingTable()`, it is never declared to
 * `generateMigration` — Supabase owns and manages this table.
 */
export const authUsers = existingTable("auth", "users", {
	id: uuid(),
	email: text(),
});
