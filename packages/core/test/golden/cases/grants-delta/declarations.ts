import { grant, schema } from "../../../../src/index";

/** The original production schema (spec §5.1), extended with its grants corpus (Phase 4 acceptance case, D28). */
export const app = schema("app");

export const usageGrants = grant(app).usage.to("anon", "service_role");

export const anonSelectGrant = grant(app).tables("select").to("anon");

export const serviceRoleFullGrant = grant(app)
	.tables("select", "insert", "update", "delete")
	.to("service_role");

export const anonDefaultSelectGrant = grant(app)
	.defaultPrivileges.tables("select")
	.to("anon");
