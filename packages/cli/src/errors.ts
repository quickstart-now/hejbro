import { HejbroError } from "@hejbro/core";

/**
 * Recovers a {@link HejbroError} from a `catch` clause's `unknown` value.
 * Shared by every command's top-level catch (generate, verify) so the
 * discriminator only has one place to get right.
 *
 * `instanceof HejbroError` — not duck-typing on "has a `code` and a
 * `message`" — because that used to misidentify any Node runtime error
 * carrying a `.code` (e.g. `ERR_MODULE_NOT_FOUND`) as a HejbroError (#125).
 * Anything that isn't actually a HejbroError is rethrown as-is, so it
 * surfaces as a crash rather than being silently rendered as a bogus
 * diagnostic.
 */
export const asHejbroError = (error: unknown): HejbroError => {
	if (error instanceof HejbroError) {
		return error;
	}
	throw error;
};
