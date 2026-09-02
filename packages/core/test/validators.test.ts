import { describe, expect, it } from "vitest";
import type { Diagnostic, DiagnosticSeverity, Validator } from "../src/index";
import {
	diagnostic,
	emptySnapshot,
	existingTable,
	generateMigration,
	getTableMeta,
	hejbroError,
	runValidators,
	schema,
	uuid,
} from "../src/index";

describe("generateMigration validators", () => {
	const app = schema("app");

	it("returns warning diagnostics in result.warnings without blocking sql", () => {
		const result = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
			validators: [() => [diagnostic("warning", "test-warning", "a warning.")]],
		});
		expect(result.warnings).toEqual([
			{
				severity: "warning",
				code: "test-warning",
				message: "a warning.",
				declaredAt: null,
			},
		]);
		expect(result.hasChanges).toBe(true);
		expect(result.sql).toContain("create schema");
	});

	it("maps error diagnostics into result.errors and blocks generation", () => {
		const result = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
			validators: [
				() => [diagnostic("error", "test-error", "an error.", "app.ts:1")],
			],
		});
		expect(result.errors).toEqual([
			hejbroError("test-error", "an error.", "app.ts:1"),
		]);
		expect(result.sql).toBe("");
		expect(result.hasChanges).toBe(false);
	});

	it("passes the built snapshot and normalized declarations to validators", () => {
		const seen: Array<ReadonlyArray<string>> = [];
		generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
			validators: [
				(snapshot, declarations) => {
					seen.push(declarations.map((d) => d.declarationKind));
					expect(Object.keys(snapshot.objects)).toContain("schema:app");
					return [];
				},
			],
		});
		expect(seen).toEqual([["schema"]]);
	});

	// D106 R3, #666: `table-declaration`'s "a validator that checks a
	// reference SHALL see it" had no observer for three rounds -- this is
	// that observer. A future refactor that quietly dropped existing
	// declarations before `runValidators` (the risk the requirement
	// itself guards against) would fail this test, not just leave the
	// requirement's own text unobserved.
	it("an existing declaration reaches the validators exactly as a managed one does (D106 R3, #666)", () => {
		const authUsers = existingTable("auth", "users", { id: uuid() });
		const seen: Array<
			ReadonlyArray<{
				readonly declarationKind: string;
				readonly existing?: boolean;
			}>
		> = [];
		generateMigration({
			declarations: [getTableMeta(authUsers)],
			previousSnapshot: emptySnapshot,
			validators: [
				(_snapshot, declarations) => {
					seen.push(
						declarations as ReadonlyArray<{
							readonly declarationKind: string;
							readonly existing?: boolean;
						}>,
					);
					return [];
				},
			],
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]).toContainEqual(
			expect.objectContaining({
				declarationKind: "table",
				existing: true,
			}),
		);
	});

	it("omitting validators yields empty warnings (back-compat)", () => {
		const result = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
		});
		expect(result.warnings).toEqual([]);
	});
});

describe("validation surface exports", () => {
	it("exposes diagnostic, runValidators, and the Diagnostic/Validator types", () => {
		const severity: DiagnosticSeverity = "warning";
		const d: Diagnostic = diagnostic(severity, "code", "message");
		const validator: Validator = () => [d];
		expect(runValidators([validator], emptySnapshot, [])).toEqual([d]);
	});
});
