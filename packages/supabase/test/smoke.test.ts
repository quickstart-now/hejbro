import { describe, expect, it } from "vitest";
import * as preset from "../src/index";

describe("package wiring", () => {
	it("imports cleanly", () => {
		expect(preset).toBeDefined();
	});
});
