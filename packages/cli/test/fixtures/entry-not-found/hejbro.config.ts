import { defineConfig } from "hejbro";

// No `src/` directory exists under this fixture — the entry pattern below
// matches zero files, exercising `entry-not-found`.
export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
