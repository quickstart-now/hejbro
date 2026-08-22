# Contract: snapshot shape (format 5, unchanged version — D84)

Index entries inside `objects["table:<schema>.<name>"].indexes`. Keys are
stable-sorted by `renderSnapshot`; absent keys mean the default.

```jsonc
// B-tree, plain column — byte-identical to 0.1.1
{ "columns": [{ "name": "status" }], "name": "posts_status_idx" }

// access method + operator class
{ "columns": [{ "name": "data", "opclass": "jsonb_path_ops" }], "method": "gin", "name": "docs_data_idx" }

// ordered + opclass
{ "columns": [{ "desc": true, "name": "score", "nulls": "last", "opclass": "int4_ops" }], "name": "docs_score_idx" }

// expression column (encodeExprNode output; D57 vocabulary: "column-ref", "sql-template")
{
  "columns": [{
    "expression": {
      "chunks": [
        { "chunkKind": "text", "text": "lower(" },
        { "chunkKind": "expr", "expr": { "column": "email", "nodeKind": "column-ref", "schema": "app", "table": "users" } },
        { "chunkKind": "text", "text": ")" }
      ],
      "nodeKind": "sql-template"
    }
  }],
  "name": "users_email_lower_idx"
}
```

Invariants:

- `method` ∈ {`hash`, `gin`, `gist`, `spgist`, `brin`, `hnsw`, `ivfflat`};
  `btree` is never written.
- A column entry has exactly one of `name` | `expression`.
- `opclass` is a D36 identifier, stored verbatim (SQL's own token — naming
  rule exception, same class as `operator` / `direction`).
- `expression` decodes with `decodeExprNode`; `guardSnapshotRead` wraps
  malformed nodes as `malformed-snapshot-node` (existing).
- `HEJBRO_SNAPSHOT_VERSION === 5` before and after; `parseSnapshot` needs
  no change (unknown keys already pass through; no zod).
- `tableKind.requiredKeys` unchanged (`schema`, `name`, `columns`,
  `indexes`, `foreignKeys`).
