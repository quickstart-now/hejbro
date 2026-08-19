import type { HejbroInput } from "../../../../src/index";
import { grant } from "../../../../src/index";
import {
	anonDefaultSelectGrant,
	anonSelectGrant,
	ddland,
	serviceRoleFullGrant,
	usageGrants,
} from "./declarations";

// Step 0: from empty — schema usage for anon/service_role, all-tables
// select for anon, all-tables full CRUD for service_role, and default
// privileges select for anon.

const fromEmpty: ReadonlyArray<HejbroInput> = [
	ddland,
	usageGrants,
	anonSelectGrant,
	serviceRoleFullGrant,
	anonDefaultSelectGrant,
];

// Step 1: anon gains insert on all tables (alter -> `grant insert ...`),
// service_role loses delete (alter -> `revoke delete ...`). usage and the
// default-privileges grant are untouched.

const anonGainsInsert = grant(ddland).tables("select", "insert").to("anon");
const serviceRoleLosesDelete = grant(ddland)
	.tables("select", "insert", "update")
	.to("service_role");

const privilegeDeltas: ReadonlyArray<HejbroInput> = [
	ddland,
	usageGrants,
	anonGainsInsert,
	serviceRoleLosesDelete,
	anonDefaultSelectGrant,
];

// Step 2: the anon default-privileges declaration is removed entirely —
// expect a drop (`alter default privileges ... revoke ...`).

const defaultPrivilegesRemoved: ReadonlyArray<HejbroInput> = [
	ddland,
	usageGrants,
	anonGainsInsert,
	serviceRoleLosesDelete,
];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	privilegeDeltas,
	defaultPrivilegesRemoved,
];
