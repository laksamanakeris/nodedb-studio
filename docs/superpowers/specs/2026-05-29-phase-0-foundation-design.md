# NodeDB Studio — Phase 0: Foundation (Design)

**Date:** 2026-05-29
**Status:** Approved (ready for implementation planning)
**Roadmap:** `2026-05-29-nodedb-studio-roadmap.md`

## Goal

Build the foundation every later feature depends on, and prove the whole stack
end to end with a single demoable slice:

> Add a connection → connect → type raw SQL → run it via `execute_sql` → see
> results in a grid (or a real, detailed error).

This is a tracer bullet, not horizontal plumbing. It exercises the connection
layer, async bridge, trait dispatch, `Value` rendering, and the capability
handshake in one path. Query-editor affordances (syntax highlighting, history,
autocomplete) are explicitly **out of scope** here — they are Phase 1.

Platform: **desktop only** (see roadmap for the web transport gap).

## Module structure

```
src/
  main.rs           # dioxus::launch(app)
  app.rs            # root component, router, context providers
  runtime.rs        # tokio↔Dioxus async glue; active Arc<dyn NodeDb> context
  conn/
    mod.rs
    profile.rs      # ConnectionProfile + serde + connstring builder
    store.rs        # config file (profiles) + keyring (passwords)
    manager.rs      # ConnectionManager: profiles, active selection, connect/switch
  caps.rs           # capability / limits / version view-model
  value.rs          # Value -> display cell
  ui/
    mod.rs
    shell.rs        # sidebar (conn switcher + nav) + status bar layout
    grid.rs         # result table + pagination
    sql_panel.rs    # raw SQL input + run (the tracer slice)
    connections.rs  # profile list / add / edit / connect
```

Each unit has one purpose, communicates through a typed interface, and is
testable in isolation. The pure-logic units (`profile`, `value`, `caps`) carry
no Dioxus or I/O dependency and are unit-tested directly.

## Components

### 1. App shell (`app.rs`, `ui/shell.rs`)

- Dioxus `Router` with routes. Phase 0 wires only `Connections` and `Sql`;
  later phases add routes without touching the shell contract.
- Layout: left sidebar (connection switcher + nav list), main pane (active
  route), bottom status bar (server version + capability badges, populated from
  the active connection's handshake).
- Context providers mounted at the root: `ConnectionManager` and the active
  `Db` handle (see Async bridge).

### 2. Connection layer (`conn/`)

`ConnectionProfile` — non-secret connection fields:

```rust
struct ConnectionProfile {
    id: Uuid,        // stable key for keyring + UI
    name: String,    // user label
    host: String,
    port: u16,
    user: String,
    dbname: String,
}
```

- `profile.rs` — the struct, `serde` (de)serialization, and a
  `connection_string()` builder that assembles the pgwire string and injects the
  password fetched from the keyring at connect time (the password is never held
  on the struct or written to the config file).
- `store.rs` — profile list persisted as JSON under the platform config dir
  (via the `directories` crate, e.g. macOS
  `~/Library/Application Support/nodedb-studio/connections.json`). Passwords
  stored/loaded via the `keyring` crate, keyed by profile `id`. Service name:
  `nodedb-studio`.
- `manager.rs` — `ConnectionManager` owns the profile list, the set of live
  connections (`HashMap<Uuid, Arc<dyn NodeDb>>`), and the active profile id.
  Operations: `add/edit/remove profile`, `connect(id)` (builds the conn-string,
  awaits `NodeDbRemote::connect`, stores the handle), `set_active(id)`,
  `disconnect(id)`. **Multi-connection is realized here**: many profiles, many
  live handles, one active at a time, switchable from the sidebar.

### 3. Async bridge (`runtime.rs`)

- Dioxus desktop already runs on a tokio runtime, so trait `async` methods are
  awaited directly inside Dioxus async primitives — no separate runtime to
  manage.
- The active connection is shared as `Arc<dyn NodeDb>` via Dioxus context.
  Switching the active profile swaps the context value, re-rendering consumers.
- UI actions (run SQL, connect) run in `use_resource` / `spawn` coroutines.
  Success pushes into a result `Signal`; `NodeDbError` pushes into an error
  `Signal`. No blocking on the UI thread.

### 4. Result grid + `Value` rendering (`ui/grid.rs`, `value.rs`)

- Input: `QueryResult { columns: Vec<String>, rows: Vec<Vec<Value>>, rows_affected }`.
- `value.rs` — pure `Value -> String`/cell formatter:
  - `Null` → muted "∅" / "NULL".
  - strings/numbers/bools → direct.
  - vectors/arrays → truncated preview (`[0.12, 0.98, … +382]`).
  - documents/nested → compact JSON snippet, expandable later.
- `grid.rs` — renders a `<table>` from columns + rows. Client-side pagination
  with a default page cap (~500 rows) to stay responsive; no virtualization yet.
- For non-row statements, show `rows_affected` instead of an empty grid.

### 5. Capability gating (`caps.rs`)

- On successful connect, read `db.capabilities()`, `db.server_version()`,
  `db.limits()`. Wrap the bitfield with `Capabilities::from_raw`.
- A `CapsView` view-model exposes booleans (`streaming/graphrag/fts/crdt/
  spatial/timeseries/columnar`) + version + limits.
- The shell renders capability badges in the status bar. Nav items and future
  feature panels read `CapsView` to show/hide/disable. Phase 0 has no
  capability-gated features yet, but the mechanism and the badges ship now so
  later phases inherit graceful degradation.

## Data flow (the tracer slice)

1. User adds/selects a `ConnectionProfile` in `connections.rs`.
2. `ConnectionManager::connect(id)` builds the conn-string (password from
   keyring), awaits `NodeDbRemote::connect`, stores the `Arc<dyn NodeDb>`, sets
   it active, and captures the handshake into `CapsView`.
3. The active `Arc<dyn NodeDb>` is provided via context; status bar shows
   version + capability badges.
4. In `sql_panel.rs`, the user types SQL and hits Run. A coroutine calls
   `db.execute_sql(sql, &[])`.
5. `Ok(QueryResult)` → result signal → `grid.rs` renders rows (or
   `rows_affected`). `Err(NodeDbError)` → error signal → inline error panel.

## Error handling

- `NodeDbError` is the result type throughout — no custom error layer in Phase 0.
- Connection failures arrive as `sync_connection_failed`; query failures as
  `storage` carrying the SQLSTATE detail (the client already extracts
  `pg_error_detail`, so the SQLSTATE + server message reach the UI).
- Failures surface in an inline error panel and/or transient toast. Empty
  results render as "0 rows", never as a swallowed error. No `unwrap` on I/O
  paths.

## Testing

- **Pure logic (TDD, no UI/IO):**
  - `profile.rs`: serde round-trip; `connection_string()` builds correct pgwire
    string and injects the password without persisting it.
  - `value.rs`: each `Value` variant → expected cell text, including truncation
    rules.
  - `caps.rs`: `CapsView` predicates match the bitfield (mirrors the existing
    `Capabilities` tests).
- **ConnectionManager:** profile add/edit/remove and active-selection
  transitions tested with a mock `Arc<dyn NodeDb>` (the trait is object-safe and
  already has a mock pattern in `nodedb-client`). Keyring access abstracted
  behind a trait so tests use an in-memory secret store.
- **Integration (gated):** a `#[ignore]` / feature-gated test connects to a
  local NodeDB (the `nodedb` repo ships `docker-compose.yml`), runs
  `SELECT 1`, and asserts the grid shape. Not run in default CI.
- **UI:** component-level assertions where Dioxus testing allows; the bulk of
  correctness lives in the pure-logic units above.

## Out of scope for Phase 0

- SQL syntax highlighting, autocomplete, query history (Phase 1).
- Any per-engine data browsing/editing (Phase 1).
- Graph/vector visualizers (Phase 2).
- Monitor/sync dashboards (Phase 3).
- Web/WASM target and any non-pgwire transport.
- Row virtualization, result export, theming beyond a basic layout.

## New dependencies

- `keyring` — OS secret store for passwords.
- `directories` — platform config-dir resolution.
- `uuid` — stable profile ids.
- `dioxus-router` — routing (within the existing `dioxus` dependency).
- `nodedb-client` built with the `remote` feature (pgwire) — current
  workspace dep does not yet enable a feature; the implementation plan must turn
  it on.
