import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["json", "text"],
			include: ["src/**/*.ts"],
		},
	},
});
