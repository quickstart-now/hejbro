# Work — quickstart-now/hejbro#458

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Three connecting commands never read the configuration

_2026-09-05T06:58Z_

runImport (commands/import.ts), runPull (commands/pull.ts) and runRaise
(commands/raise.ts) call loadConfig nowhere; only check, status, migrate
and reset do. loadConfig throws config-not-found when no file is present
(loader.ts). pull's connection flag is --db-url, not --url.

<a id="w2"></a>
## W2 — import, pull and raise take no --config flag

_2026-09-05T06:58Z_

Once these three read the configuration they are the only config-reading
commands with no --config flag. Out of scope for add-config-driver by
lead ruling 458/R2 item 3; harden-config-root handles it. No code here.

