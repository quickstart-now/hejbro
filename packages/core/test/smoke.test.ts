import { describe, expect, it } from "vitest";
import { HEJBRO_SNAPSHOT_VERSION } from "../src/index";

describe("package wiring", () => {
	it("exposes the snapshot version constant", () => {
		expect(HEJBRO_SNAPSHOT_VERSION).toBe(6);
	});
});
