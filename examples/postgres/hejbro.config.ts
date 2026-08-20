import { defineConfig } from "hejbro";

export default defineConfig({
	// Only the live entry point — `src/steps/*.schema.ts` are historical
	// snapshots for `test/chain.test.ts` to import directly, not additional
	// declaration sources (each declares its own `schema("app")`, which
	// would collide with `src/app.schema.ts`'s if the glob swept them in).
	entry: ["src/app.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
	presets: [],
});
