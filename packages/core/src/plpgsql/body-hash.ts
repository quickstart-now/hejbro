const fnvOffsetBasis32 = 0x811c9dc5;
const fnvPrime32 = 0x01000193;

/**
 * 32-bit FNV-1a hash of `text`, as an 8-character lowercase hex string.
 * Used as the function-kind change-detection key (`bodyHash`) — deliberately
 * not cryptographic, just fast and deterministic, with zero dependencies.
 */
export const fnv1aHex = (text: string): string => {
	const bytes = new TextEncoder().encode(text);
	const hash = bytes.reduce(
		(accumulator, byte) => Math.imul(accumulator ^ byte, fnvPrime32) >>> 0,
		fnvOffsetBasis32,
	);
	return hash.toString(16).padStart(8, "0");
};
