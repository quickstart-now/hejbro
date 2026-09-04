# Decisions — quickstart-now/hejbro#793

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — The bot-pin credential: register it directly; a PAT issued by the owner

_owner · 2026-09-04T05:41Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#8,9,10_

> Owner, told that bot pinning needs a secret: "Register it yourself." Then, offered the three credential paths (owner-issued fine-grained PAT, the gh OAuth token, or staying in local mode): "Issue one yourself and handle it." When a per-repository deploy key — the only credential the lead can create — was refused by the org policy that disables deploy keys, and the choice was put again: "Fine, I'll click through it then," followed by a request for the exact token name, repository access and permissions.

Decided: the credential is a fine-grained PAT the owner issues — resource owner quickstart-now, repositories hejbro and agent-skills, Contents: Read and write — registered as `BLACKBOX_TOKEN` in both repositories from a file through `gh secret set`, so the value never enters a conversation. The org's deploy-key policy stays as it is; the gh OAuth token (admin:org scope) is not used. This PR is the witness: CI pins it by itself.

<a id="d2"></a>
## D2 — The bot is a GitHub App with a cat avatar; its pin commits must be signed

_owner · 2026-09-04T06:09Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#12,13,14,15_

> Owner, seeing the unsigned pin commits blocked by the signed-commit rulesets and wanting the bot to have a face: "At least put an image on blackbox-bot — and on the quickstart.now org too. Cat-themed." Then, offered a GitHub App against signing with the owner's SSH key or forcing the merges: chose the App. "Create it yourself." When the name `blackbox-bot` turned out to be reserved: "Just something like `hello-pooh-blackbox`." Then: "I've logged in" (into the automation browser), so the lead could drive the manifest flow.

Decided: the bot identity is the GitHub App `hello-pooh-blackbox` (quickstart-now; Contents write, Metadata read, Pull requests read; installed on hejbro and agent-skills; id and private key stored as `BLACKBOX_APP_ID` / `BLACKBOX_APP_PRIVATE_KEY`). Pin commits are created through the Git Data API under the App's token, so GitHub signs them and shows the App's avatar — which satisfies `required_signatures` without touching the ruleset. The PAT registered earlier stays as a fallback path. Cat avatars: the owner supplies the pictures (two generated cats, cropped to 640 px squares by the lead) and uploads them to the App and the org profile.

