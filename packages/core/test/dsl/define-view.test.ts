import { describe, expect, it } from "vitest";
import { defineView } from "../../src/dsl/define-view";
import { schema } from "../../src/dsl/schema";
import { table } from "../../src/dsl/table";
import { isNotNull } from "../../src/expr/operators";
import { select } from "../../src/query/select";
import { timestamptz, uuid } from "../../src/types/column-builder-factories";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	publishedAt: timestamptz(),
});

describe("defineView", () => {
	it("builds a view declaration from a select chain (spec §5.4)", () => {
		const view = defineView(
			app,
			"published_posts",
			select(posts).where(isNotNull(posts.publishedAt)),
		);
		expect(view.declarationKind).toBe("view");
		expect(view.schema).toBe(app);
		expect(view.viewName).toBe("published_posts");
		expect(view.query.queryKind).toBe("select");
		expect(view.securityInvoker).toBe(false);
	});

	it("passes through securityInvoker: true", () => {
		const view = defineView(app, "published_posts", select(posts), {
			securityInvoker: true,
		});
		expect(view.securityInvoker).toBe(true);
	});
});
