# Work — quickstart-now/hejbro#712

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — catalog inference hardened: policy roles, enum names, the dropped primary-key name, foreign keys at omitted columns, one comparator

_2026-09-06T05:26Z_

Five gaps in the catalog reading and its loss report closed in one change: role names are unioned from `pg_policies.roles` as well as the three grant sources, and `public` is never reported; an enum type whose catalog name D36 rejects is omitted with every column typed by it and named on one line; a primary key whose catalog name is not the derived one is announced as an approximation with the only way out there is; a foreign key at a column the reading left out -- for its own name or for the enum type that typed it -- is omitted with it and announced once, its reason naming the end that failed; and every list `import` and `pull` print, the starter declarations' own handle and column order included, sorts by code points through one shared comparator.

Measured rather than assumed. (1) #873's symptom is one step earlier than the issue stated: the reading dies in core's `findForeignColumnRef` before any file is written, so `import` produces neither declarations nor a loss report. (2) `check`'s inventory has no enum axis, so the omitted-enum line names the column and states explicitly that the type is not named. (3) A dropped primary-key name costs two signals, an unmanaged-index line on stdout and a `check-object-missing` finding on stderr, so keeping the catalog name is not a way out. (4) The live witness on postgres:17-alpine printed one foreign key twice: Postgres allows an enum-to-enum foreign key only over one type, so losing the type loses both ends at once -- a shape no unit fixture had built.

Falsification. Every task predicted its mutations' red cells before running them and compared after: the shared comparator (back to `localeCompare`; always 0), role inference (`public` filter; policy source; first role only), the foreign-key column axis (source end only; target end only; whole table), the primary-key name (both gates; swapped names; first table only; name comparison alone), the enum rule (same schema only; columns dropped from the line; a column already omitted for its name; the enum alone; the enum-cause column removed from the foreign-key set), the cause-specific lines (name-cause sentence reused; dedup removed; dedup inverted), and the live witness (`roles` column removed; enum partition disabled; `roles` transported as an empty array). Three predictions were wider or narrower than the run: each was recorded as measured, and two of them corrected the tests instead of the code -- an assertion that read the whole report where it meant one line, and an assertion that sat in the cell of a cause it did not test.

