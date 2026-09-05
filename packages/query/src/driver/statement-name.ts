import { createHash } from "node:crypto";

/**
 * `hejbro_` + the first 32 hex digits of SHA-256 over `sql` (task 1.5,
 * #891, add-prepared-statements design Q4): 39 bytes, inside Postgres's
 * 63-byte identifier limit. A pure function of `sql` alone -- the same
 * text yields the same name on every connection and in every process,
 * and two different texts practically never collide (their whole
 * 256-bit digests would have to). Exported here, the driver contract's
 * own module, so a driver declaring `"prepared-statements"` derives its
 * statement names from this one function rather than each holding a
 * byte-identical copy.
 */
export const preparedStatementName = (sql: string): string =>
	`hejbro_${createHash("sha256").update(sql).digest("hex").slice(0, 32)}`;
