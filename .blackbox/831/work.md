# Work — quickstart-now/hejbro#831

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Config-path refusals name the file once

_2026-09-04T22:28Z_

Config-path refusals name the file once

`init`'s refusal for a directory sitting where `hejbro.config.ts` (or the file named by `--config`) belongs used to read `"<path>" was expected to be a file for hejbro.config.ts, but a directory is there` — the field's own name (`hejbro.config.ts`) appeared once as the quoted label and again as the "for" clause, reading as "hejbro.config.ts ... for hejbro.config.ts" whenever the flag was omitted. The wording now opens with `"<path>" is the configuration path, but a directory is there — the configuration is a file hejbro reads`, naming the path exactly once; the same sentence is shared (via `loader.ts`'s exported `configNotAFileMessage`, different trailing clause) with the read side's `config-not-a-file` refusal, so `init` and `generate` answer a directory at the configuration path with the same first sentence.

The dangling-link case at the configuration path got the same treatment: `"<path>" is the configuration path, but a dangling symbolic link is there, pointing at "<target>"`.

Landed together with #846's D2/D5/D6 work (same commits: cdfdfc86 for the ancestor-ordering fix that this wording rides on, d9b7624f for the phrasing itself) since both the correct node-naming and the non-repeating wording depend on the same `checkArtifactPath`/`probePath` refactor.

Representative test cases: init.test.ts "describes a directory at --config as the configuration path, naming it once", "refuses a directory sitting where the configuration file belongs" (updated pin, was the doubled-name text before), and the init/generate parity subprocess rows under "the configuration path's own messages".

