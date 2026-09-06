/**
 * Compares two strings by UTF-16 code unit, never by a collation --
 * review round 1 N1: `localeCompare` made the inventory's order depend
 * on the running machine's own locale (measured: the same database
 * printed a different order under `LC_ALL=en_US.UTF-8` than under
 * `LC_ALL=sv_SE.UTF-8`), and a normalization pair (NFC/NFD -- two
 * different Postgres identifiers) compared equal under it, so a stable
 * sort fell back to whatever order the catalog happened to return them
 * in. Guard clauses, not a ternary (house style): `<`/`>` compare
 * JavaScript strings by UTF-16 code unit, which coincides with code
 * point order for every identity outside the astral planes -- review
 * round 2 N5 (non-blocking): a real astral-plane pair (`"a😀"` U+1F600
 * vs `"aﬀ"` U+FB00) sorts by code unit, not true code point, but the
 * properties this rule needs -- a total order, locale-independent, no
 * ties -- all still hold; a true code-point compare needs iterating the
 * string, which house style bans (no loops).
 */
export const compareCodeUnits = (a: string, b: string): number => {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
};
