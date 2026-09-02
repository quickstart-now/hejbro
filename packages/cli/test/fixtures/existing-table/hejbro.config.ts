// Fixture config for loader.test.ts's own existingTable characterization
// pin (add-unmanaged-objects, 2.2) -- same shape as fixtures/basic's.
import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
