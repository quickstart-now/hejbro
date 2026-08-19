import { grant, schema } from "../../../../src/index";

/** The dd.land example schema (spec §5.1), extended with its grants corpus (Phase 4 acceptance case, D28). */
export const ddland = schema("ddland");

export const usageGrants = grant(ddland).usage.to("anon", "service_role");

export const anonSelectGrant = grant(ddland).tables("select").to("anon");

export const serviceRoleFullGrant = grant(ddland)
	.tables("select", "insert", "update", "delete")
	.to("service_role");

export const anonDefaultSelectGrant = grant(ddland)
	.defaultPrivileges.tables("select")
	.to("anon");
