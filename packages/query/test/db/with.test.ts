import { bigint, schema, select, table, uuid, withCte } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { columnPlanForStatement, convertRow } from "../../src/db/convert";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	amount: bigint({ mode: "bigint" }),
});
const tables = { posts };

describe("a field needing conversion arrives converted through a with wrapper (add-ctes task 5.3)", () => {
	it("a bigint field projected through a CTE reads back as a real bigint, not the driver's raw text", () => {
		const stage = withCte((w) => {
			const ranked = w.as("ranked", select(posts));
			return select({ id: ranked.id, amount: ranked.amount }, ranked);
		});
		const plan = columnPlanForStatement(stage, tables);
		const converted = convertRow({ id: "1", amount: "9007199254740993" }, plan);
		expect(converted.amount).toBe(9007199254740993n);
		expect(typeof converted.amount).toBe("bigint");
	});
});
