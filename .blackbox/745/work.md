# Work — quickstart-now/hejbro#745

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Half of #745 was already closed; the config label half is fixed and pinned

_2026-09-05T05:22Z_

Measured 2026-09-05 on the built CLI (dev fffea4dc): `snapshotPath: ""` is now refused with error[invalid-config] snapshotPath ("is empty, but the snapshot is a file") -- the EISDIR half closed with harden-config-paths-2. The other half reproduced: `export default { entry: 42 }` printed `config field "entry" in /private/tmp/p745/hejbro.config.ts is missing…`. Fix: loader.ts hands parseConfig the relative label (relLabel(cwd, configPath)); the pin in packages/cli/test/loader.test.ts went red on the absolute path with the fix stashed, green with it; the cli suite passes after `pnpm build --force` (the loader tests import hejbro through jiti and need dist).

