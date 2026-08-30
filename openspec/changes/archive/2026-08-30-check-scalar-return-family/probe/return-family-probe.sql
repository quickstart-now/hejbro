-- #478 probe: which (declared return type <- returned expression type) pairs
-- does Postgres accept/refuse when a plpgsql body's RETURN expression is
-- coerced to the declared return type? Run on postgres:17.
-- Records per-probe outcome; aggregation by SqlTypeFamily happens below.

create table if not exists probe_results (
	decl_type text not null,
	src_expr text not null,
	ok boolean not null,
	sqlstate text,
	msg text
);
truncate probe_results;

do $probe$
declare
	decl text;
	src text;
	decls text[] := array[
		'uuid',
		'text', 'varchar(10)', 'char(3)',
		'smallint', 'integer', 'bigint', 'real', 'double precision', 'numeric',
		'boolean',
		'date', 'time', 'timetz', 'timestamp', 'timestamptz',
		'interval',
		'json', 'jsonb',
		'bytea',
		'inet', 'cidr', 'macaddr',
		'integer[]', 'text[]'
	];
	srcs text[] := array[
		-- uuid family
		$s$'00000000-0000-0000-0000-000000000000'::uuid$s$,
		$s$'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid$s$,
		-- text family (adversarial values that parse as other families)
		$s$'abc'::text$s$,
		$s$'123'::text$s$,
		$s$'2026-01-01'::text$s$,
		$s$'t'::text$s$,
		$s$'{"a":1}'::text$s$,
		$s$'{1,2}'::text$s$,
		$s$'00000000-0000-0000-0000-000000000000'::text$s$,
		$s$'1 day'::text$s$,
		$s$'192.168.0.1'::text$s$,
		$s$'12:34:56'::text$s$,
		$s$'ab'::varchar(10)$s$,
		-- numeric family (20260101 parses as an ISO date)
		$s$0::integer$s$,
		$s$1::integer$s$,
		$s$42.5::numeric$s$,
		$s$20260101::integer$s$,
		$s$2.5::real$s$,
		$s$9223372036854775807::bigint$s$,
		-- boolean family
		$s$true$s$,
		$s$false$s$,
		-- datetime family
		$s$'2026-01-01'::date$s$,
		$s$'12:34:56'::time$s$,
		$s$'12:34:56+05'::timetz$s$,
		$s$'2026-01-01 12:34:56'::timestamp$s$,
		$s$'2026-01-01 12:34:56+00'::timestamptz$s$,
		-- interval family ('00:00:01' output parses as time)
		$s$'1 day'::interval$s$,
		$s$'00:00:01'::interval$s$,
		$s$'1 year 2 mons'::interval$s$,
		-- json family (scalar payloads whose text form parses elsewhere)
		$s$'{"a":1}'::jsonb$s$,
		$s$'1'::jsonb$s$,
		$s$'"abc"'::jsonb$s$,
		$s$'true'::jsonb$s$,
		$s$'"2026-01-01"'::jsonb$s$,
		$s$'1'::json$s$,
		-- bytea family
		$s$'\xdeadbeef'::bytea$s$,
		$s$'\x31'::bytea$s$,
		-- net family
		$s$'192.168.0.1'::inet$s$,
		$s$'10.0.0.0/8'::cidr$s$,
		$s$'08:00:2b:01:02:03'::macaddr$s$,
		-- array family
		$s$array[1,2]$s$,
		$s$array['a','b']$s$,
		$s$'{}'::integer[]$s$
	];
begin
	foreach decl in array decls loop
		foreach src in array srcs loop
			begin
				execute 'drop function if exists probe_fn()';
				execute format(
					'create function probe_fn() returns %s language plpgsql as %L',
					decl,
					format('begin return %s; end', src)
				);
				execute 'select probe_fn()';
				insert into probe_results values (decl, src, true, null, null);
			exception when others then
				insert into probe_results
					values (decl, src, false, sqlstate, left(sqlerrm, 120));
			end;
		end loop;
	end loop;
	execute 'drop function if exists probe_fn()';
end
$probe$;
