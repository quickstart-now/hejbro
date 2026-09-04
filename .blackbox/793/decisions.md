# Decisions — quickstart-now/hejbro#793

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — The bot-pin credential: register it directly; a PAT issued by the owner

_owner · 2026-09-04T05:41Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#8,9,10_

> Owner, told that bot pinning needs a secret: "Register it yourself." Then, offered the three credential paths (owner-issued fine-grained PAT, the gh OAuth token, or staying in local mode): "Issue one yourself and handle it." When a per-repository deploy key — the only credential the lead can create — was refused by the org policy that disables deploy keys, and the choice was put again: "Fine, I'll click through it then," followed by a request for the exact token name, repository access and permissions.

Decided: the credential is a fine-grained PAT the owner issues — resource owner quickstart-now, repositories hejbro and agent-skills, Contents: Read and write — registered as `BLACKBOX_TOKEN` in both repositories from a file through `gh secret set`, so the value never enters a conversation. The org's deploy-key policy stays as it is; the gh OAuth token (admin:org scope) is not used. This PR is the witness: CI pins it by itself.

