// Fixture config for loader-cycle.test.ts (#669) -- the mirror of
// reference-cycle-forward with the alphabetically-first file swapped, so
// the loader reaches the other half of the same cycle first.
import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
