declare const roleBrand: unique symbol;

/** A Postgres role name carrying compile-time provenance (D43). Assignable to `string` anywhere a plain role name is expected. */
export type Role = string & { readonly [roleBrand]: true };

/** Brands a role name as a {@link Role}. The single sanctioned assertion in core (brand constructors cannot avoid it). */
export const roleName = (name: string): Role => name as Role;
