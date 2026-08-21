---
"hejbro": minor
---

`hejbro generate`/`hejbro verify` no longer crash with a raw, uncaught
Node error when `hejbro.config.ts` or a declaration file imports a
package that fails to resolve (not installed, or installed with an
`exports` field that doesn't resolve) — this now renders as a proper §7
diagnostic (`config-load-failed`/`declaration-load-failed`) naming the
failing file and the underlying reason, instead of the uncaught stack
trace #125 reported. A declaration file's own DSL validation errors
(e.g. an invalid identifier) are unaffected and keep rendering with
their own code and location, exactly as before.
