import type { HejbroError } from "../../error";
import { hejbroError } from "../../error";
import { tableIdentity } from "../../kinds/table-snapshot";
import { compareKeys } from "../../sort";
import type {
	NameSets,
	SchemaTableSets,
	TableColumnSets,
} from "./snapshot-sets";
import type {
	ColumnRenameSpec,
	ConfirmDropSpec,
	RenameSpec,
	TableRenameSpec,
} from "./types";

/**
 * One spec's claim on an old or new name — grouped by `groupKey` (which
 * encodes target kind, scope, direction, and name) to find two specs that
 * claim the same identifier. Carries enough to render a human-readable
 * message (never a raw internal key — m3 fix).
 */
export type Claim = {
	readonly groupKey: string;
	readonly targetKind: "column" | "table";
	readonly schemaName: string;
	readonly tableName: string | null;
	readonly direction: "old" | "new";
	readonly name: string;
	readonly specIndex: number;
};

export const specClaims = (
	spec: RenameSpec,
	specIndex: number,
): ReadonlyArray<Claim> => {
	if (spec.target === "column") {
		const scope = tableIdentity(spec.schemaName, spec.tableName);
		return [
			{
				groupKey: `column-old:${scope}:${spec.oldName}`,
				targetKind: "column",
				schemaName: spec.schemaName,
				tableName: spec.tableName,
				direction: "old",
				name: spec.oldName,
				specIndex,
			},
			{
				groupKey: `column-new:${scope}:${spec.newName}`,
				targetKind: "column",
				schemaName: spec.schemaName,
				tableName: spec.tableName,
				direction: "new",
				name: spec.newName,
				specIndex,
			},
		];
	}
	return [
		{
			groupKey: `table-old:${spec.schemaName}:${spec.oldName}`,
			targetKind: "table",
			schemaName: spec.schemaName,
			tableName: null,
			direction: "old",
			name: spec.oldName,
			specIndex,
		},
		{
			groupKey: `table-new:${spec.schemaName}:${spec.newName}`,
			targetKind: "table",
			schemaName: spec.schemaName,
			tableName: null,
			direction: "new",
			name: spec.newName,
			specIndex,
		},
	];
};

export const groupClaims = (
	claims: ReadonlyArray<Claim>,
): ReadonlyMap<string, ReadonlyArray<Claim>> =>
	claims.reduce((acc, claim) => {
		const existing = acc.get(claim.groupKey) ?? [];
		acc.set(claim.groupKey, [...existing, claim]);
		return acc;
	}, new Map<string, ReadonlyArray<Claim>>());

/** The qualified identifier string a claim targets (`schema.table.column` or `schema.table`) — the owner-approved messages address the identifier directly, not "old"/"new" prose (⑥ verbatim). */
export const claimIdentifier = (claim: Claim): string => {
	if (claim.targetKind === "column") {
		return `${tableIdentity(claim.schemaName, claim.tableName ?? "")}.${claim.name}`;
	}
	return tableIdentity(claim.schemaName, claim.name);
};

export const claimUnitLabel = (claim: Claim): "column" | "table" =>
	claim.targetKind;

export const firstClaimOf = (claims: ReadonlyArray<Claim>): Claim | null => {
	const [first] = claims;
	if (first === undefined) {
		return null;
	}
	return first;
};

export const duplicateIdentifierOf = (claim: Claim | null): string => {
	if (claim === null) {
		return "";
	}
	return claimIdentifier(claim);
};

export const duplicateUnitLabelOf = (
	claim: Claim | null,
): "column" | "table" => {
	if (claim === null) {
		return "column";
	}
	return claimUnitLabel(claim);
};

/** "two --rename flags" for the common (owner-approved verbatim) case, "<N> --rename flags" otherwise. */
export const duplicateFlagCountPhrase = (count: number): string => {
	if (count === 2) {
		return "two --rename flags";
	}
	return `${count} --rename flags`;
};

export const findDuplicateRenameSpecs = (
	renames: ReadonlyArray<RenameSpec>,
): {
	readonly duplicatedIndices: ReadonlySet<number>;
	readonly errors: ReadonlyArray<HejbroError>;
} => {
	const grouped = groupClaims(
		renames.flatMap((spec, index) => specClaims(spec, index)),
	);
	const duplicateGroups = Array.from(grouped.entries())
		.filter(([, claims]) => new Set(claims.map((c) => c.specIndex)).size > 1)
		.sort((a, b) => compareKeys(a[0], b[0]));
	const duplicatedIndices = new Set(
		duplicateGroups.flatMap(([, claims]) => claims.map((c) => c.specIndex)),
	);
	const errors = duplicateGroups.map(([, claims]) => {
		const first = firstClaimOf(claims);
		const count = new Set(claims.map((c) => c.specIndex)).size;
		const identifier = duplicateIdentifierOf(first);
		const unit = duplicateUnitLabelOf(first);
		return hejbroError(
			"duplicate-rename-target",
			`${duplicateFlagCountPhrase(count)} both reference "${identifier}" (as an old or new name) — a dropped ${unit} can be claimed by at most one rename, and an added ${unit} can be the target of at most one rename. Next: remove or fix the duplicate --rename flag.`,
		);
	});
	return { duplicatedIndices, errors };
};

/**
 * Does `oldName`/`newName` match a genuine drop+add pair in `sets`?
 * Shared by {@link validateTableRenameTarget}/{@link
 * validateColumnRenameTarget}, both of which ask exactly this question of
 * a `NameSets` lookup (a schema's tables, or a table's columns) — one
 * predicate instead of the same `?? false`-guarded pair repeated twice.
 */
export const isDropAddPair = (
	sets: NameSets | undefined,
	oldName: string,
	newName: string,
): boolean =>
	(sets?.dropped.has(oldName) ?? false) && (sets?.added.has(newName) ?? false);

/** {@link validateRenameSpecTarget}'s `"table"` case: `spec`'s old/new names must match a table this run actually drops/adds in that schema. */
export const validateTableRenameTarget = (
	spec: TableRenameSpec,
	schemaTableSets: SchemaTableSets,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): HejbroError | null => {
	const sets = schemaTableSets.get(spec.schemaName);
	if (isDropAddPair(sets, spec.oldName, spec.newName)) {
		return null;
	}
	const declaredAt =
		declaredAtByIdentity.get(tableIdentity(spec.schemaName, spec.newName)) ??
		null;
	return hejbroError(
		"unknown-rename-target",
		`--rename "${spec.schemaName}.${spec.oldName}=${spec.newName}" doesn't match this run: schema "${spec.schemaName}" has no dropped table named "${spec.oldName}" (or no added table named "${spec.newName}"). Next: check both names for typos — --rename's left side must be a table this run drops, the right side a table this run adds.`,
		declaredAt,
	);
};

/** {@link validateRenameSpecTarget}'s `"column"` case: `spec`'s old/new names must match a column this run actually drops/adds on that table. */
export const validateColumnRenameTarget = (
	spec: ColumnRenameSpec,
	tableColumnSets: TableColumnSets,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): HejbroError | null => {
	const identity = tableIdentity(spec.schemaName, spec.tableName);
	const sets = tableColumnSets.get(identity);
	if (isDropAddPair(sets, spec.oldName, spec.newName)) {
		return null;
	}
	const declaredAt = declaredAtByIdentity.get(identity) ?? null;
	return hejbroError(
		"unknown-rename-target",
		`--rename "${identity}.${spec.oldName}=${spec.newName}" doesn't match this run: table "${identity}" has no dropped column named "${spec.oldName}" (or no added column named "${spec.newName}"). Next: check both names for typos — --rename's left side must be a column this run drops, the right side a column this run adds.`,
		declaredAt,
	);
};

export const validateRenameSpecTarget = (
	spec: RenameSpec,
	schemaTableSets: SchemaTableSets,
	tableColumnSets: TableColumnSets,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): HejbroError | null => {
	if (spec.target === "table") {
		return validateTableRenameTarget(
			spec,
			schemaTableSets,
			declaredAtByIdentity,
		);
	}
	return validateColumnRenameTarget(
		spec,
		tableColumnSets,
		declaredAtByIdentity,
	);
};

export const partitionRenameSpecs = (
	renames: ReadonlyArray<RenameSpec>,
	schemaTableSets: SchemaTableSets,
	tableColumnSets: TableColumnSets,
	declaredAtByIdentity: ReadonlyMap<string, string | null>,
): {
	readonly validSpecs: ReadonlyArray<RenameSpec>;
	readonly errors: ReadonlyArray<HejbroError>;
} => {
	const { duplicatedIndices, errors: duplicateErrors } =
		findDuplicateRenameSpecs(renames);
	const targetErrorOf = (spec: RenameSpec): HejbroError | null =>
		validateRenameSpecTarget(
			spec,
			schemaTableSets,
			tableColumnSets,
			declaredAtByIdentity,
		);
	const targetErrorUnlessDuplicated = (
		spec: RenameSpec,
		index: number,
	): HejbroError | null => {
		if (duplicatedIndices.has(index)) {
			return null;
		}
		return targetErrorOf(spec);
	};
	const targetErrors = renames
		.map((spec, index) => targetErrorUnlessDuplicated(spec, index))
		.filter((error): error is HejbroError => error !== null);
	const validSpecs = renames.filter(
		(spec, index) =>
			!duplicatedIndices.has(index) && targetErrorOf(spec) === null,
	);
	return { validSpecs, errors: [...duplicateErrors, ...targetErrors] };
};

/** {@link validateConfirmDropTarget}'s `target: "table"` half: `spec.tableName` must be a table this run's schema actually drops. */
export const validateConfirmDropTableTarget = (
	spec: Extract<ConfirmDropSpec, { readonly target: "table" }>,
	schemaTableSets: SchemaTableSets,
): HejbroError | null => {
	const sets = schemaTableSets.get(spec.schemaName);
	if (sets?.dropped.has(spec.tableName) ?? false) {
		return null;
	}
	const identity = tableIdentity(spec.schemaName, spec.tableName);
	return hejbroError(
		"unknown-confirm-drop-target",
		`--confirm-drop "${identity}" doesn't match this run: schema "${spec.schemaName}" has no dropped table named "${spec.tableName}". Next: check the name for typos — --confirm-drop's target must be a column (or table) this run actually drops.`,
	);
};

/** {@link validateConfirmDropTarget}'s `target: "column"` half: `spec.columnName` must be a column this run's table actually drops. */
export const validateConfirmDropColumnTarget = (
	spec: Extract<ConfirmDropSpec, { readonly target: "column" }>,
	tableColumnSets: TableColumnSets,
): HejbroError | null => {
	const identity = tableIdentity(spec.schemaName, spec.tableName);
	const sets = tableColumnSets.get(identity);
	if (sets?.dropped.has(spec.columnName) ?? false) {
		return null;
	}
	return hejbroError(
		"unknown-confirm-drop-target",
		`--confirm-drop "${identity}.${spec.columnName}" doesn't match this run: table "${identity}" has no dropped column named "${spec.columnName}". Next: check the name for typos — --confirm-drop's target must be a column (or table) this run actually drops.`,
	);
};

export const validateConfirmDropTarget = (
	spec: ConfirmDropSpec,
	schemaTableSets: SchemaTableSets,
	tableColumnSets: TableColumnSets,
): HejbroError | null => {
	if (spec.target === "table") {
		return validateConfirmDropTableTarget(spec, schemaTableSets);
	}
	return validateConfirmDropColumnTarget(spec, tableColumnSets);
};

export const partitionConfirmDrops = (
	confirmedDrops: ReadonlyArray<ConfirmDropSpec>,
	schemaTableSets: SchemaTableSets,
	tableColumnSets: TableColumnSets,
): {
	readonly validDrops: ReadonlyArray<ConfirmDropSpec>;
	readonly errors: ReadonlyArray<HejbroError>;
} => {
	const errorOf = (spec: ConfirmDropSpec): HejbroError | null =>
		validateConfirmDropTarget(spec, schemaTableSets, tableColumnSets);
	const errors = confirmedDrops
		.map((spec) => errorOf(spec))
		.filter((error): error is HejbroError => error !== null);
	const validDrops = confirmedDrops.filter((spec) => errorOf(spec) === null);
	return { validDrops, errors };
};

// --- Steps 3+4: apply valid renames, rewriting `previous` --------------
