-- examples/brownfield/seed/brownfield.sql
--
-- A hand-written, ORM-shaped dump of a database hejbro did not create
-- (#714). Every D106 round on add-catalog-inference (R1 #680, R2 #689,
-- R3 #705, R4 #710, R5 #711) constructed its own throwaway database to
-- find one of these shapes; this file holds every one of them in a
-- single, standing corpus. No CREATE ROLE, no GRANT -- applied as
-- `postgres` (psql -f), the way the standing witness applies it.
--
-- R5-blocked schemas (import aborts on these today -- #711, D106 round 5,
-- OPEN, not yet merged to dev): shop, people, inventory.
-- Clean schemas (import succeeds today, R1-R4 already on dev): app,
-- audit, billing, catalog, "Marketing".
--
-- Round attribution is per shape (`-- shape: ...` above the object that
-- carries it), sourced from each round's own issue body (`gh issue view
-- <n>`), never guessed.

-- ---------------------------------------------------------------------
-- audit / app / billing: a three-schema foreign-key chain of tables all
-- named "users" (shape: R2 #689 -- "three schemas each holding `users`
-- chained by foreign keys emitted `import { users2 }` beside
-- `export const users2` -- a duplicate declaration"), combined with a
-- cross-schema enum reference running the opposite direction of the
-- adjacent foreign key (shape: R1 #680 -- "a cross-schema enum
-- reference was not a file-graph edge ... produced an import cycle the
-- emitter never cut, and the loader crashed under either file order").
-- Both rounds are already on dev (upstream/dev a3c3d802 and earlier), so
-- this trio is expected to import cleanly today.
-- ---------------------------------------------------------------------

create schema audit;

-- shape: R1 #680 -- the enum lives in "audit" but is referenced from a
-- column in "app" (app.users.kind below), the opposite direction of the
-- foreign key audit.users -> app.users a few lines down.
create type audit.event_kind as enum ('info', 'warning', 'error');

create schema app;

create table app.users (
	id uuid primary key default gen_random_uuid(),
	email text not null unique,
	kind audit.event_kind not null default 'info',
	created_at timestamptz not null default now()
);

-- shape: R3 #705 -- an ordinary, unnamed inline `references` gets
-- Postgres's own default constraint name (`<table>_<column>_fkey`), never
-- hejbro's own `<table>_<columns>_fk` -- app.orders_user_id_fkey.
create table app.orders (
	id serial primary key,
	user_id uuid not null references app.users (id),
	created_at timestamptz not null default now()
);

-- shape: R2 #689 -- second node of the three-schema "users" chain, and
-- (paired with app.users.kind above) the opposite-direction half of the
-- R1 #680 enum/FK cycle on the same schema pair (app, audit).
create table audit.users (
	id serial primary key,
	app_user_id uuid not null references app.users (id),
	logged_in_at timestamptz not null default now()
);

create schema billing;

-- shape: R2 #689 -- third node of the three-schema "users" chain.
create table billing.users (
	id serial primary key,
	audit_user_id integer not null references audit.users (id),
	balance numeric(12, 2) not null default 0
);

-- ---------------------------------------------------------------------
-- catalog: per-object omission of an invalid (CamelCase) index/check name
-- beside a valid table (shape: R4 #710 -- "an index or check with an
-- invalid name is omitted too rather than declared under a derived
-- name"), the historical `*/`-in-a-loss-report-line header break (shape:
-- R3 #705 -- "a column named `a*/b` no longer breaks the file"), plus a
-- handful of pre-existing (non-D106-round) approximation/loss shapes:
-- a UNIQUE constraint approximated as a same-named unique index, a
-- `serial` column (owned sequence, no loss), a `generated always as
-- identity` column, an unowned `nextval(...)` default (approximated, its
-- own sequence never inferred), a partial index, an expression index.
-- Already on dev, expected clean today.
-- ---------------------------------------------------------------------

create schema catalog;

create sequence catalog.external_ref_seq;

create table catalog.products (
	id serial primary key,
	serial_num integer generated always as identity,
	external_ref integer not null default nextval('catalog.external_ref_seq'),
	sku text not null,
	price numeric(10, 2) not null,
	-- shape: R3 #705 -- the exact historical repro: a column whose SQL
	-- name contains `*/`, which used to close the starter file's own
	-- header block comment when it reached a loss-report line.
	"a*/b" text,
	constraint products_sku_key unique (sku),
	constraint products_price_check check (price > 0)
);

-- catalog.external_ref_seq is never linked via ALTER SEQUENCE ... OWNED
-- BY -- isSerialOwned stays false, so the raw `nextval(...)` default
-- survives only as an approximation (loss-report.ts's
-- detectNextvalDefaultApproximations), and the sequence itself is a
-- second, independent "Not inferred: sequence ..." line (no column owns
-- it, per D66 -- the DSL has no defineSequence()).

create index products_active_idx on catalog.products (id) where price > 0;
create index products_lower_sku_idx on catalog.products (lower(sku));

create table catalog.orders (
	id serial primary key,
	status text not null,
	total numeric(10, 2) not null,
	-- shape: R4 #710 -- an invalid (CamelCase) check-constraint name on an
	-- otherwise validly-named, surviving table; the check alone is
	-- omitted, catalog.orders itself stays declared.
	constraint "CK_Orders_Total" check (total >= 0)
);

-- shape: R4 #710 -- same as above, for an index instead of a check.
create index "IX_Orders_Status" on catalog.orders (status);

-- ---------------------------------------------------------------------
-- "Marketing": a whole schema whose own catalog name is not a valid
-- hejbro SQL identifier (shape: R4 #710 -- "a table or schema with an
-- invalid name is omitted with its dependents"), CamelCase beside every
-- snake_case schema above it. Deliberately not referenced by anything
-- outside itself, so its omission stays self-contained and clean today
-- (unlike the shapes in "shop" below, which chain an invalid name
-- through a live foreign key -- still R5-blocked).
-- ---------------------------------------------------------------------

create schema "Marketing";

create table "Marketing".campaigns (
	id serial primary key,
	name text not null
);

-- ---------------------------------------------------------------------
-- shop: R5-blocked (#711, OPEN -- not yet merged). R5-B1 -- "a foreign
-- key whose *target* table or schema has a name no declaration can
-- carry still aborts the whole reading" -- and R5-N2 (non-blocking, same
-- issue) -- "the UNIQUE-constraint approximation is detected on the
-- schema-filtered catalog rather than the surviving tables, so an
-- omitted table still gets an `Approximated:` line".
-- ---------------------------------------------------------------------

create schema shop;

-- shape: R4 #710 (table-level omission, on its own) crossed with R5-B1 /
-- R5-N2 #711 (a live foreign key into it, and a UNIQUE constraint on it)
-- -- "Widgets" is CamelCase, so its own name is not a valid hejbro SQL
-- identifier.
create table shop."Widgets" (
	id serial primary key,
	sku text not null,
	-- shape: R5-N2 #711 -- a UNIQUE constraint on a table R4 #710 would
	-- otherwise cleanly omit.
	unique (sku)
);

-- shape: R5-B1 #711 -- shop.orders is validly named and otherwise
-- unremarkable, but its own foreign key targets the omitted
-- shop."Widgets" -- today this aborts import/pull entirely instead of
-- being omitted and named, for the whole run, not just this table.
create table shop.orders (
	id serial primary key,
	widget_id integer not null references shop."Widgets" (id)
);

-- ---------------------------------------------------------------------
-- people: R5-blocked (#711, OPEN). R5-B2 -- "a column whose SQL name
-- starts with `_` round-trips through the key rule but fails
-- assertSqlName in table(), so it aborts the reading instead of being
-- omitted and named."
-- ---------------------------------------------------------------------

create schema people;

-- shape: R5-B2 #711 -- the leading-underscore column `_id` (kept
-- deliberately distinct from the table's own primary key, which is
-- named plainly).
create table people.accounts (
	id uuid primary key default gen_random_uuid(),
	_id text,
	email text not null
);

-- ---------------------------------------------------------------------
-- inventory: R5-blocked (#711, OPEN). R5-B3 -- "checksFor matches a
-- check expression on schema + constraint name only, so two tables in
-- one schema sharing a check name get each other's expression; the
-- baseline DDL then fails against the very database it was read from."
-- ---------------------------------------------------------------------

create schema inventory;

-- shape: R5-B3 #711 -- both tables below name their own CHECK
-- constraint "pos", with different expressions.
create table inventory.terminals (
	id serial primary key,
	status text not null,
	constraint pos check (status in ('open', 'closed'))
);

create table inventory.registers (
	id serial primary key,
	balance numeric(12, 2) not null,
	constraint pos check (balance >= 0)
);
