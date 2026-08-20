import { createHash } from "node:crypto";

/** `sha256(text)` as lowercase hex — shared by `generate` (banner hashes) and `verify` (tip comparison), the only two places the CLI hashes anything (core never does). */
export const sha256Hex = (text: string): string =>
	createHash("sha256").update(text).digest("hex");
