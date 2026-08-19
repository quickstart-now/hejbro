/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"type-enum": [
			2,
			"always",
			[
				"feat", // new feature
				"fix", // bug fix
				"docs", // documentation
				"style", // code formatting (no behavior change)
				"refactor", // refactoring
				"test", // tests
				"chore", // build, config, misc
				"perf", // performance
				"ci", // CI/CD
				"build", // build system, external dependencies
				"revert", // revert a commit
			],
		],
		"header-max-length": [2, "always", 72],
		"subject-empty": [2, "never"],
		"subject-case": [2, "always", "lower-case"],
		"subject-full-stop": [2, "never", "."],
		"scope-case": [2, "always", "lower-case"],
		"body-max-line-length": [2, "always", 100],
		"type-empty": [2, "never"],
	},
};
