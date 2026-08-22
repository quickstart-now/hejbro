import { describe, expect, it } from "vitest";
import {
	defineFunction,
	functionKind,
	schema,
	select,
	table,
	uuid,
} from "../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
});

describe("defineFunction", () => {
	it("accepts the declared schema object and derives the identity from it", () => {
		const fn = defineFunction(app, "f", { returns: posts }, (ctx) => {
			ctx.return(select(posts));
		});
		expect(fn.schemaName).toBe("app");
		expect(functionKind.identify(functionKind.serialize(fn))).toBe("app.f");
	});

	it("still accepts the schema name as a string (deprecated on 0.1.x)", () => {
		const fn = defineFunction("app", "g", { returns: posts }, (ctx) => {
			ctx.return(select(posts));
		});
		expect(fn.schemaName).toBe("app");
	});

	it("both forms produce the same snapshot for the same function", () => {
		const fromObject = functionKind.serialize(
			defineFunction(app, "publish_post", { returns: posts }, (ctx) => {
				ctx.return(select(posts));
			}),
		);
		const fromString = functionKind.serialize(
			defineFunction("app", "publish_post", { returns: posts }, (ctx) => {
				ctx.return(select(posts));
			}),
		);
		expect(fromObject).toEqual(fromString);
	});
});
