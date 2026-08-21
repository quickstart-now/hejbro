import { describe, expect, it } from "vitest";
import { storageBucket } from "../src/storage/bucket";
import { schemaOf } from "../src/validators/schema-of";

describe("schemaOf", () => {
	it("returns null for a storage bucket declaration (no owning schema)", () => {
		// Not a hypothetical future-kind fallback: HejbroDeclaration is
		// structurally open ({ declarationKind: string }), and the storage
		// bucket kind's declarationKind ("supabase-storage-bucket") doesn't
		// match any of schemaOf's checks -- a bucket has no owning schema,
		// it's a row in Supabase's own storage.buckets. This is the one
		// real path to schemaOf's final `return null` (see the function's
		// own doc comment for why "check"/"grant-set" don't reach here).
		const bucket = storageBucket("avatars");
		expect(schemaOf(bucket)).toBeNull();
	});
});
