// Fixture config for loader-cycle.test.ts (#669) -- two schema files whose
// tables reference each other, a real ESM circular import between them.
import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
