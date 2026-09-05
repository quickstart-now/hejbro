# Work — quickstart-now/hejbro#830

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — config-not-found names the path looked up and init --config; config path judged before loading

_2026-09-04T22:28Z_

config-not-found names the path looked up and init --config; config path judged before loading

`loader.ts`'s `loadConfig` previously hard-coded the flagless not-found text ("no hejbro.config.ts was found...") even when `--config` pointed elsewhere, so `hejbro generate --config sub/hejbro.config.ts` on an empty directory told the user to create a file (`hejbro.config.ts`) they never asked for. `loadConfig` now branches on whether a `--config` flag was given: flagless stays byte-identical to the owner-approved golden text (pinned by the existing `golden.test.ts`/`loader.test.ts:42`/`verify.test.ts:312`, reconfirmed passing); under a flag, the message names the actual path looked up (relative to `cwd`, never absolute) and its `Next:` says `hejbro init --config <path>` with the same value the user passed.

This landed together with #846/NB8 and #831 in the same change (`resolveConfigPath`/`loadConfig` now probe the resolved path with `path-probe.ts`'s `probePath` before ever calling jiti — see the #846 work entry for the shared mechanism): a directory or a dangling link at the `--config` path is `config-not-a-file`, an ancestor/permission/uninspectable path is `config-unreadable`, both naming the real node — neither reaches jiti's own import-resolution diagnostic, which is what used to surface `config-load-failed` (masking the config-not-found intent) or, for `--config=`/`--config .`, leaked the working directory's absolute path in a `Cannot find module` message.

Commit: 9dcf170f (config-not-found path fix; config-not-a-file/config-unreadable land in the same commit since they share `loadConfig`'s new probe).

Representative test cases: loader.test.ts "names the path actually looked up under --config in config-not-found's Next:", "names an absolute --config path relative to cwd, never as an absolute path, when absent"; generate-command.test.ts "refuses --config . as config-not-a-file naming ./, never an absolute path".

