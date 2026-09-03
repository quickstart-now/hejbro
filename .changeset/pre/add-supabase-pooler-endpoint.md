---
"@hejbro/supabase": minor
---

`supabaseDriver(driver, options?)` takes an optional `endpoint`: `"session"`
(the default — a direct connection or Supabase's session-mode pooler,
unchanged behavior) or `"transaction-pooler"`, Supabase's transaction-mode
pooler (Supavisor, port 6543). The pooler path declares
`session-state: false` and carries its `IntervalStyle`/`bytea_output`
pins transaction-locally with every execution instead of once per
connection — measured against a local stack, the vanilla driver's
once-per-connection pin does not reliably survive the pooler reassigning
backend connections between transactions. An unrecognized `endpoint`
value is rejected at construction with a coded error naming the
recognized values, never silently downgraded to the session path.
