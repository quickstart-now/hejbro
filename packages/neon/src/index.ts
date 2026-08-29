// The Neon preset's public surface (task 6.1): the driver, the roles,
// the auth expression helpers, the auth-surface factory with its mode
// type, and the claims type its claims-mode builder accepts. No `Preset`
// bundle -- this package registers no object kinds and no validators
// (proposal.md's "Out of scope"), so there is nothing for one to carry.
export { authJwt, authUid } from "./auth";
export type { Claims, NeonAuthMode } from "./context";
export { neonAuth } from "./context";
export { neonDriver } from "./driver";
export { anonymousRole, authenticatedRole } from "./roles";
