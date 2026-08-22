import { createHash } from "node:crypto";

/**
 * `sha256(input)` as lowercase hex — shared by `generate` (banner
 * hashes), `verify` (tip comparison), and `history`/`restore` (M3's git
 * blob-vs-banner comparison, #130), the only places the CLI hashes
 * anything (core never does). `Buffer` input hashes the exact bytes a
 * git blob (or a file on disk) carries, with no text-decoding step in
 * between — the same guarantee `text` input gives for an in-memory
 * string.
 */
export const sha256Hex = (input: string | Buffer): string =>
	createHash("sha256").update(input).digest("hex");
