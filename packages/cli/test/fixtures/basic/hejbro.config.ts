// Fixture config for loader.test.ts. Imports `defineConfig` from the
// `hejbro` package itself (self-reference, not a relative path) — this
// doubles as the U2 self-import-cycle smoke test: if `hejbro`'s own
// package.json exports/dist can't resolve from within a loaded file, this
// fixture fails to load.
import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
