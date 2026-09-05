# Decisions — quickstart-now/hejbro#491

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Client ranges move to the pnpm catalog, guarded by check:client-ranges

_lead · interpretation · basis 412/D24, 412/D25; measured 2026-09-05: changeset publish selects pnpm here (check:pnpm-publish-tool), and pnpm pack rewrites catalog: to the resolved range in peerDependencies and devDependencies of the packed manifest (@hejbro/pg -> pg ^8.23.0, @types/pg ^8.23.1; @hejbro/neon -> @neondatabase/serverless ^1.1.0) · 2026-09-05T05:00Z · ratified: pending_

Policy: one declaration per client range in pnpm-workspace.yaml's catalog; every manifest spells `catalog:`; `pnpm check:client-ranges` (CI, every leg) refuses a manifest that spells its own range or names a client the catalog lacks. Chosen over explicit duplication + a checker because the catalog removes the duplication itself and the publish path was measured to resolve it. Ratification: owner on return.

