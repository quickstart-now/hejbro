\set ON_ERROR_STOP off
\echo '-- whole-set order by on the recursive union'
with recursive r(n) as (select 1 union all select n+1 from r where n < 3 order by n) select * from r;
\echo '-- whole-set limit'
with recursive r(n) as (select 1 union all select n+1 from r where n < 3 limit 2) select * from r;
\echo '-- whole-set offset'
with recursive r(n) as (select 1 union all select n+1 from r where n < 3 offset 1) select * from r;
\echo '-- order by / limit / offset parenthesized inside the recursive term'
with recursive r(n) as (select 1 union all (select n+1 from r where n < 3 order by n limit 1 offset 0)) select * from r;
