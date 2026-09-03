import { compile } from "hejbro";
import { describe, expect, it } from "vitest";
import { projectTaskReport } from "../src/reporting.query";

describe("the reporting query compiles to the expected SQL and parameters (#474 3.2)", () => {
	it("compiles a join + aggregate + window report with no bind parameters", () => {
		const compiled = compile(projectTaskReport);
		expect(compiled.params).toEqual([]);
		expect(compiled.sql).toBe(
			'select "app"."projects"."id" as "project_id", "app"."projects"."name" as "project_name", "app"."members"."display_name" as "owner_name", count("app"."tasks"."id") as "task_count", rank() over (order by count("app"."tasks"."id") desc) as "task_count_rank" ' +
				'from "app"."projects" ' +
				'inner join "app"."members" on "app"."members"."id" = "app"."projects"."owner_id" ' +
				'left join "app"."tasks" on "app"."tasks"."project_id" = "app"."projects"."id" ' +
				'group by "app"."projects"."id", "app"."projects"."name", "app"."members"."display_name"',
		);
	});
});
