import { describe, expect, it } from "vitest";
import { supabasePreset, supabaseValidators } from "../src/index";

describe("supabasePreset", () => {
	it("is named supabase", () => {
		expect(supabasePreset.name).toBe("supabase");
	});

	it("carries the storage bucket kind", () => {
		expect(supabasePreset.kinds.map((kind) => kind.kind)).toEqual([
			"supabase-storage-bucket",
		]);
	});

	it("carries every supabase validator", () => {
		expect(supabasePreset.validators).toEqual(supabaseValidators);
	});
});
