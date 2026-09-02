import { describe, expect, it } from "vitest";
import type { LossReportFacts } from "../src/infer/loss-report";
import { buildLossReport } from "../src/infer/loss-report";

const emptyFacts = (command: "import" | "pull"): LossReportFacts => ({
	command,
	roleNames: [],
	notInferred: {
		functions: [],
		triggers: [],
		views: [],
		policies: [],
		grantsBeyondRoleName: true,
	},
	standaloneSequences: [],
	typeLosses: [],
	uniqueIndexApproximations: [],
	nextvalDefaults: [],
	undeclarableNameColumns: [],
});

describe("buildLossReport / 1.7", () => {
	it("names exactly the delta's not-inferred elements when every kind is present", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			notInferred: {
				functions: [{ schema: "app", name: "touch_updated_at" }],
				triggers: [{ schema: "app", table: "posts", name: "posts_touch" }],
				views: [{ schema: "app", name: "open_tasks" }],
				policies: [{ schema: "app", table: "posts", name: "posts_read_all" }],
				grantsBeyondRoleName: true,
			},
			standaloneSequences: [{ schema: "app", name: "orphan_seq" }],
			typeLosses: [
				{
					schema: "app",
					table: "widgets",
					column: "location",
					sqlType: "point",
				},
			],
		});

		expect(report.some((line) => line.includes("function"))).toBe(true);
		expect(report.some((line) => line.includes("trigger"))).toBe(true);
		expect(report.some((line) => line.includes("view"))).toBe(true);
		expect(report.some((line) => line.includes("policy"))).toBe(true);
		expect(
			report.some((line) => line.includes("grants beyond their role name")),
		).toBe(true);
		expect(report.some((line) => line.includes("app.orphan_seq"))).toBe(true);
		expect(
			report.some((line) =>
				line.includes('app.widgets.location" (type "point"'),
			),
		).toBe(true);
	});

	it("names the UNIQUE-constraint-as-index approximation", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			uniqueIndexApproximations: [
				{ schema: "app", table: "pairs", name: "pairs_a_b_unique" },
			],
		});

		expect(
			report.some(
				(line) =>
					line.includes("pairs_a_b_unique") &&
					line.includes("create unique index") &&
					line.includes("add constraint"),
			),
		).toBe(true);
	});

	it("names the nextval-default approximation", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			nextvalDefaults: [
				{
					schema: "app",
					table: "legacy",
					column: "id",
					sequence: "legacy_id_seq",
				},
			],
		});

		expect(
			report.some(
				(line) => line.includes("nextval") && line.includes("legacy_id_seq"),
			),
		).toBe(true);
	});

	it("import: names an undeclarable-name column, its table, and the exact consequence", () => {
		const report = buildLossReport({
			...emptyFacts("import"),
			undeclarableNameColumns: [
				{ schema: "app", table: "widgets", sqlName: "createdAt" },
			],
		});

		const line = report.find((entry) => entry.includes("createdAt"));
		expect(line).toBeDefined();
		expect(line).toContain("app.widgets");
		expect(line).toContain("only partly declared");
		expect(line).toContain("check");
		expect(line).toContain("declared by hand or renamed in the database");
	});

	it("pull: never omits an undeclarable-name column, and says the way out is linking the schema repository", () => {
		const report = buildLossReport({
			...emptyFacts("pull"),
			undeclarableNameColumns: [
				{ schema: "app", table: "widgets", sqlName: "createdAt" },
			],
		});

		// pull's own contract carries every column (CI-G1-R1-08 (C)) -- an
		// undeclarable-name column is never a reason to omit anything, so
		// this input is not even meaningful for pull; the way-out line is
		// what actually matters here.
		expect(report.some((line) => line.includes("link"))).toBe(true);
	});

	it("import: says the way out is hand-editing the starter declarations", () => {
		const report = buildLossReport(emptyFacts("import"));

		expect(report.some((line) => line.includes("hand-edit"))).toBe(true);
	});
});
