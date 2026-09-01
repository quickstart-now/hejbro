// Shared prelude for skills/hejbro/references/polyrepo.md's
// `prelude=polyrepo-contract` snippets -- a hand-written stand-in for a
// real vendored `.hejbro/vendor/contract.ts` (hand-written here rather
// than generated, since `hejbro vendor` needs a real git remote this
// fixture can't provide), matching the exact shape `emitContract` writes:
// a `Database` interface, a `contractMetadata` constant, and
// `createDb(conn)` bound to it via `createNameKeyedDb`. `pgDriver(...)`
// only constructs a `Pool`; it never connects until a statement actually
// runs, so this type-checks with no live database (same reasoning as
// query-handle.ts's own prelude). Its `Database` interface's PascalCase
// members (`Tables`/`Row`/`Insert`/`Update`/...) are exempted from this
// repo's own naming convention in `biome.json` -- this fixture exists to
// reproduce someone else's convention (Supabase's own generated `Database`
// shape, which `emitContract` deliberately mirrors), and renaming the keys
// to satisfy our own rule would defeat the fixture's entire point.
import { pgDriver } from "@hejbro/pg";
import type { Driver } from "hejbro";
import { createNameKeyedDb } from "hejbro";

export interface Database {
	readonly Tables: {
		posts: {
			readonly Row: { readonly id: string; readonly title: string };
			readonly Insert: { readonly id?: string; readonly title: string };
			readonly Update: { readonly id?: string; readonly title?: string };
			readonly Relationships: readonly [];
		};
	};
	readonly Views: { [key: string]: never };
	readonly Functions: { [key: string]: never };
	readonly Enums: Record<string, never>;
}

export const contractMetadata = {
	commit: "0".repeat(40),
	exportHash: `sha256:${"0".repeat(64)}`,
	roles: [] as const,
	tables: {
		posts: {
			schema: "app",
			name: "posts",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				title: {
					sqlName: "title",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		},
	},
} as const;

export const createDb = (conn: Driver) =>
	createNameKeyedDb<Database>(conn, contractMetadata);

export const driver = pgDriver(
	process.env.DATABASE_URL ?? "postgres://localhost:5432/app",
);
