# NodeDB Studio — Architecture

**Status:** Living document
**Last updated:** 2026-05-29
**Related:** `superpowers/specs/2026-05-29-nodedb-studio-roadmap.md`,
`superpowers/specs/2026-05-29-phase-0-foundation-design.md`

This document describes the overall architecture of NodeDB Studio and the
implementation details that span features. Per-phase specs cover individual
features in depth; this is the system-level reference.

---

## 1. Purpose & scope

NodeDB Studio is a desktop GUI client for [NodeDB](https://github.com/NodeDB-Lab/nodedb):
a query editor, multi-engine data browser, and administration console. It is
built with [Dioxus](https://dioxuslabs.com) (Rust) and talks to a NodeDB Origin
instance over the PostgreSQL wire protocol (pgwire).

In scope: connecting to one or more NodeDB instances, running SQL, browsing and
editing data across the eight engines, visualizing graph and vector data, and
observing server state.

Out of scope (current): the web/WASM target (see §16), embedded NodeDB-Lite, and
any non-pgwire transport.

---

## 2. System context

```
┌──────────────────────────────────────────────┐
│              NodeDB Studio (desktop)           │
│                                                │
│   Dioxus UI  ──►  App state  ──►  NodeDb trait │
│                                       │        │
│                                  NodeDbRemote  │
│                                  (pgwire/TCP)  │
└───────────────────────────────────────┼───────┘
                                         │  PostgreSQL wire protocol
                                         ▼
                              ┌────────────────────┐
                              │   NodeDB Origin     │
                              │  8 engines, 1 SQL   │
                              │  vector · graph ·   │
                              │  document · columnar│
                              │  timeseries · KV ·  │
                              │  FTS · array        │
                              └────────────────────┘
```

Studio depends on two crates from the sibling `nodedb` workspace:

- **`nodedb-client`** — the `NodeDb` trait (unified async query interface) and
  `NodeDbRemote` (pgwire client). Built with the `remote` feature.
- **`nodedb-types`** — shared types: `Value`, `Document`, `QueryResult`,
  `SearchResult`, `SubGraph`, `GraphStats`, `Capabilities`, `Limits`, errors.

Studio never speaks the wire protocol directly. It calls the `NodeDb` trait;
`NodeDbRemote` translates calls into SQL/DSL and ships them over pgwire.

### Transport reality (why desktop-only)

`NodeDbRemote` uses `tokio-postgres` over raw TCP. The `native` MessagePack
client uses `tokio-rustls`, also raw TCP. Browsers expose no raw TCP, so a
Dioxus web (WASM) build cannot open either transport. Web is deferred until a
browser-compatible transport (WebSocket/HTTP) exists in `nodedb-client`. All
architecture below assumes the desktop target.

---

## 3. Architecture principles

1. **One database handle, behind a trait.** All data access goes through
   `Arc<dyn NodeDb>`. The UI never knows it is talking to pgwire; swapping in a
   future transport or NodeDB-Lite is a construction-site change.
2. **Typed methods first, raw SQL as escape hatch.** Use `vector_search`,
   `graph_traverse`, `document_get`, etc. where they exist; fall back to
   `execute_sql` for ad-hoc queries and DDL.
3. **Capability-driven UI.** The server advertises which engines it supports.
   The UI shows, hides, or disables features accordingly, so Studio degrades
   gracefully against any NodeDB build.
4. **No silent failures.** Every `NodeDbError` reaches the user with its
   SQLSTATE/detail. Empty results never masquerade as errors and vice versa.
5. **Isolated, testable units.** Pure logic (value formatting, connection-string
   building, capability mapping) has no UI or I/O dependency and is unit-tested
   directly. UI components stay thin.
6. **Secrets off disk.** Passwords live in the OS keychain, never in config
   files.

---

## 4. High-level architecture (layers)

```
┌─────────────────────────────────────────────────────────────┐
│ Presentation        Dioxus components, routes, layout         │
│                     shell · sql_panel · grid · connections    │
│                     (later) graph_explorer · vector_viewer …  │
├─────────────────────────────────────────────────────────────┤
│ Application state   Signals + context. View-models:           │
│                     CapsView, result/error signals, active Db │
├─────────────────────────────────────────────────────────────┤
│ Connection/session  ConnectionManager: profiles, live handles,│
│                     active selection. Persistence (config +   │
│                     keyring).                                  │
├─────────────────────────────────────────────────────────────┤
│ Data access         NodeDb trait → NodeDbRemote (pgwire).      │
│                     Typed ops + execute_sql. nodedb-types.     │
└─────────────────────────────────────────────────────────────┘
```

Dependencies point downward only. Presentation reads state; state calls the
connection layer; the connection layer owns data-access handles. Nothing lower
imports anything higher.

---

## 5. Layer details

### 5.1 Presentation (Dioxus)

- Single-window desktop app launched via `dioxus::launch`.
- `dioxus-router` defines routes; the shell renders a persistent sidebar
  (connection switcher + nav) and status bar, with the active route in the main
  pane.
- Components are functions returning `Element`. They read application state from
  signals/context and dispatch actions through coroutines. They contain no
  blocking work and no direct database calls beyond awaiting the shared handle.

### 5.2 Application state

- **Signals** (`Signal<T>`) hold reactive UI state: current result set, current
  error, loading flags, form inputs.
- **Context** (`use_context`) provides app-wide handles: the `ConnectionManager`
  and the active `Arc<dyn NodeDb>`. Switching the active connection swaps the
  context value, re-rendering consumers.
- **View-models** are plain structs derived from server/data types for display:
  `CapsView` (capabilities + version + limits), and later per-feature models.
  Keeping a view-model layer means components don't reach into raw protocol types.

### 5.3 Connection & session

`ConnectionManager` is the heart of session state:

```
ConnectionManager
├── profiles:  Vec<ConnectionProfile>          // non-secret, persisted
├── live:      HashMap<Uuid, Arc<dyn NodeDb>>   // open connections
├── active:    Option<Uuid>                     // currently selected
└── caps:      HashMap<Uuid, CapsView>          // per-connection handshake
```

- `ConnectionProfile { id, name, host, port, user, dbname }` — serialized to a
  JSON config file under the platform config dir (`directories` crate).
- Passwords stored/retrieved via the `keyring` crate, keyed by profile `id`,
  service `nodedb-studio`.
- `connect(id)` builds the pgwire connection string (password fetched from
  keyring at connect time), awaits `NodeDbRemote::connect`, stores the handle,
  and captures the handshake (`capabilities`, `server_version`, `limits`) into a
  `CapsView`.
- Multi-connection: many profiles, many live handles, one active at a time,
  switchable from the sidebar.

### 5.4 Data access

- `Arc<dyn NodeDb>` is the only data-access surface. Object-safe trait, so a
  single handle type serves every feature and is trivially mockable in tests.
- **Typed methods** map directly to features: vector/graph/document/text
  operations, batch ops, collection lifecycle.
- **`execute_sql(query, params) -> QueryResult`** is the generic path for the
  query editor, DDL, and engines without a typed method (KV, columnar,
  timeseries, array — reached via SQL).

---

## 6. Module map (full application)

Organized by the phase that introduces each module (see roadmap).

```
src/
  main.rs                 # entrypoint: dioxus::launch(app)
  app.rs                  # root component, router, context providers   [P0]
  runtime.rs              # tokio↔Dioxus glue; active Db context         [P0]
  caps.rs                 # CapsView: capabilities/limits/version        [P0]
  value.rs                # Value -> display cell formatter              [P0]
  conn/
    profile.rs            # ConnectionProfile + serde + connstring       [P0]
    store.rs              # config file + keyring persistence            [P0]
    manager.rs            # ConnectionManager                            [P0]
  ui/
    shell.rs              # sidebar + status bar layout                  [P0]
    grid.rs               # result table + pagination                   [P0]
    sql_panel.rs          # raw SQL run (tracer slice)                   [P0]
    connections.rs        # profile list / add / edit / connect          [P0]
    query_editor.rs       # SQL editor: highlight, history, autocomplete [P1]
    collections.rs        # create / alter / drop / inspect              [P1]
    browser/              # per-engine data browsing + editing           [P1]
    graph_explorer.rs     # interactive graph visualization              [P2]
    vector_viewer.rs      # 2D/3D vector projection                      [P2]
    monitor.rs            # live metrics / active queries / CDC          [P3]
    sync_dashboard.rs     # CRDT sync status / deltas / devices          [P3]
```

---

## 7. Concurrency & async model

- The `NodeDb` trait is `async` (`async_trait`, `Send` on native). Dioxus desktop
  runs on a tokio runtime, so trait methods are awaited directly inside Dioxus
  async primitives.
- UI actions launch work with `use_resource` (for data tied to inputs) or
  `spawn` (for one-shot commands like "connect" / "run query"). The UI thread
  never blocks on I/O.
- Results flow back into `Signal`s, which trigger re-render. Errors flow into a
  dedicated error signal.
- `NodeDbRemote` internally spawns a background task to drive the pgwire
  connection; its client is `Arc<Mutex<Client>>`, so concurrent queries on one
  connection serialize at the mutex. Cross-connection queries are independent.
- Long-running/streaming reads (Phase 3 monitor) will use coroutines that poll
  on an interval and push deltas into signals.

---

## 8. State management model

- **Local component state** → `use_signal`.
- **Shared app state** → context (`ConnectionManager`, active `Db`,
  global error/toast channel).
- **Derived display state** → view-models computed from data/protocol types.
- No external state library; Dioxus signals + context cover the needs. The
  rule: components subscribe to the narrowest signal that satisfies them, to
  keep re-renders local.

---

## 9. Data model & rendering

The pgwire result is `QueryResult { columns: Vec<String>, rows: Vec<Vec<Value>>,
rows_affected: u64 }`. Typed methods return richer shapes:

- `SearchResult { id, node_id, distance, metadata }` — vector/text search.
- `SubGraph { nodes: Vec<SubGraphNode>, edges: Vec<SubGraphEdge> }` — traversal.
- `GraphStats { collection, node_count, edge_count, distinct_label_count, labels }`.
- `Document { id, fields: HashMap<String, Value> }`.

### The `Value` formatter (`value.rs`)

`Value` is a rich enum; the formatter must handle every variant. This is a core
shared unit reused by the grid, the data browser, and detail views:

| Variant | Cell rendering |
|---|---|
| `Null` | muted `NULL` |
| `Bool`, `Integer`, `Float` | direct text |
| `String` | direct (truncated past N chars, expandable) |
| `Bytes` | hex/size summary (`<24 bytes>`) |
| `Array`, `Set` | bracketed preview, length suffix |
| `Object` | compact JSON snippet, expandable |
| `Uuid`, `Ulid` | direct |
| `DateTime`, `NaiveDateTime` | ISO-8601 formatted |
| `Duration` | humanized |
| `Decimal` | exact string (no float coercion) |
| `Geometry` | type + summary (`Point(…)`); map preview later |
| `Regex` | pattern string |
| `Range` | `start..=end` notation |
| `Record` | `table:id`, clickable cross-reference later |
| `ArrayCell` | coords + attrs summary |
| Vector / embedding | truncated preview `[0.12, 0.98, … +382]` |

The formatter returns a display string plus a hint (e.g. "expandable",
"numeric", "reference") so the grid can right-align numbers, offer expansion, or
make records clickable without re-inspecting the `Value`.

---

## 10. Capability negotiation & gating

- On connect, the handshake yields a `u64` capability bitfield, a server version
  string, and per-operation `Limits`.
- `Capabilities::from_raw(bits)` exposes predicates: `supports_streaming`,
  `supports_graphrag`, `supports_fts`, `supports_crdt`, `supports_spatial`,
  `supports_timeseries`, `supports_columnar`.
- `CapsView` bundles these with version + limits for the active connection.
- Effects:
  - Status bar shows capability badges + version.
  - Nav items and feature panels gate on capabilities (e.g. hide the vector
    viewer if no vector engine; disable timeseries browsing without
    `supports_timeseries`).
  - `Limits` constrain inputs (e.g. clamp top-k to `max_top_k`, cap scan
    `LIMIT` to `max_scan_limit`).

This mechanism ships in Phase 0 even though Phase 0 gates nothing yet, so every
later phase inherits graceful degradation for free.

---

## 11. Error handling

- `NodeDbError` / `NodeDbResult` is the result type end to end — no custom error
  layer.
- Connection failures arrive as `sync_connection_failed`; query failures as
  `storage` carrying the SQLSTATE + server message (the client already runs
  `pg_error_detail`, so the diagnostic reaches the UI intact).
- Surfacing: an inline error panel near the action that failed, plus a transient
  toast for background failures. The error signal is cleared on the next
  successful action.
- No `unwrap`/`expect` on I/O or user-input paths. Empty result sets render as
  "0 rows", distinct from errors.

---

## 12. Security model

- **Credentials.** Passwords are stored only in the OS secret store
  (macOS Keychain / Windows Credential Manager / Linux Secret Service) via
  `keyring`. The config file holds host/port/user/dbname only. Connection
  strings carrying the password are assembled in memory at connect time and
  never serialized.
- **Keyring abstraction.** Access goes through a small trait so tests use an
  in-memory store and never touch the real OS keychain.
- **TLS.** `NodeDbRemote::connect` currently uses `NoTls`. Encrypted transport
  (rustls) is a follow-up once the connection layer is stable; tracked as a
  constraint, not yet implemented.
- **Destructive actions.** `DROP … PURGE` and hard deletes require explicit
  confirmation in the UI and are admin-gated server-side.

---

## 13. Configuration & persistence

- **Config dir** resolved via `directories` (e.g. macOS
  `~/Library/Application Support/nodedb-studio/`).
- **`connections.json`** — the profile list (non-secret fields).
- **Keyring** — one secret per profile id.
- **App preferences** (theme, last-active connection, page size) — a small
  `settings.json` alongside connections (introduced when first needed).

---

## 14. Per-feature architecture

How each README feature maps onto the client API and rendering. Phase in
brackets.

| Feature | Primary API | Rendering | Notes / risk |
|---|---|---|---|
| Query editor [P1] | `execute_sql` | result grid | Editor affordances (highlight/history/autocomplete) are client-side; the data path is the Phase 0 slice. |
| Collection management [P1] | `execute_sql` (DDL) + `undrop_collection` / `drop_collection_purge` / `list_dropped_collections` | forms + lists | Inspect via `SHOW`/`_system` queries. |
| Data browser [P1] | `document_get/put/delete`, `vector_*`, `graph_*`, `execute_sql` for KV/columnar/timeseries/array | grid + per-engine editors | **Edit** is the hard part — pgwire is read-mostly; edit scope pinned per engine in P1 design. |
| Graph explorer [P2] | `graph_traverse`, `graph_shortest_path`, `graph_pagerank`, `graph_stats` | force-directed graph canvas | Layout/rendering library choice (SVG/canvas/WebGL) is a P2 decision. |
| Vector space viewer [P2] | `vector_search` + bulk vector reads via SQL | 2D/3D scatter, clustering | **No server projection** — PCA/UMAP/t-SNE run client-side; cost for large sets must be scoped. |
| Real-time monitor [P3] | `_system.*` / `SHOW` via `execute_sql` (TBD) | live charts/tables | **API-blocked** — active queries/CDC/resource metrics have no typed method; needs a spike. |
| Sync dashboard [P3] | CRDT/sync APIs (TBD) | status panels | **API-blocked** — no typed methods for delta queue / conflict / device list; needs a spike. |
| Multi-connection [P0] | `NodeDbRemote::connect` + `ConnectionManager` | sidebar switcher | Foundational; implemented in Phase 0. |

---

## 15. Testing strategy

- **Pure logic (TDD):** `value.rs` formatting per variant, `profile.rs`
  serde + connection-string building, `caps.rs` predicate mapping. No UI/IO.
- **ConnectionManager:** profile CRUD and active-selection transitions, using a
  mock `Arc<dyn NodeDb>` (the trait ships a mock pattern) and an in-memory
  keyring.
- **Integration (gated):** `#[ignore]`/feature-gated tests connect to a local
  NodeDB (the `nodedb` repo ships `docker-compose.yml`), run real queries, and
  assert result shapes. Excluded from default CI.
- **UI:** component-level assertions where Dioxus testing supports them; the
  bulk of correctness lives in the pure units.

---

## 16. Build, run, distribution

- **Toolchain:** Rust edition 2024, `rust-version` 1.94 (from the workspace).
- **Dev:** `dx serve` (Dioxus CLI) or `cargo run` for the desktop target.
- **Release:** `cargo build --release`; binary at `target/release/nodedb-studio`.
  `lto = "thin"`, `strip = true` per workspace profile.
- **Local dev against the NodeDB workspace:** the README documents a
  `.cargo/config.toml` `[patch.crates-io]` pointing `nodedb-client` /
  `nodedb-types` at the sibling checkout.
- **Distribution:** Dioxus bundling (`dx bundle`) produces per-OS desktop
  artifacts (Linux/macOS/Windows) for the releases page.
- **Web (future):** blocked on a WASM transport; not part of the current build.

---

## 17. Technology stack

| Concern | Choice |
|---|---|
| UI framework | Dioxus 0.6 (desktop) |
| Routing | `dioxus-router` |
| Async runtime | tokio (provided by Dioxus desktop) |
| DB access | `nodedb-client` (`remote`/pgwire) + `nodedb-types` |
| Serialization | `serde`, `sonic-rs` |
| Secrets | `keyring` |
| Config paths | `directories` |
| IDs | `uuid` |
| Errors | `thiserror` (lib), `NodeDbError` (DB) |
| Logging | `tracing` |

---

## 18. Constraints & risks

| Constraint / risk | Impact | Disposition |
|---|---|---|
| No raw TCP in browser | Web target unbuildable | Desktop-first; defer web |
| pgwire `NoTls` today | Plaintext transport | Add rustls after connection layer stabilizes |
| pgwire read-mostly | Generic row editing is hard | Scope edit per engine in P1 |
| No server vector projection | Client must reduce dimensions | Client-side PCA/UMAP; scope cost in P2 |
| No typed monitor/sync API | P3 may be partly unbuildable | API-availability spike before P3 |
| One mutex per connection | Serialized queries per handle | Acceptable; parallelism across connections |

---

## 19. Evolution

- **Web target** when a WASM-compatible transport (WebSocket/HTTP) lands in
  `nodedb-client`. The `Arc<dyn NodeDb>` abstraction means the UI/state layers
  should not need rewrites — only the construction site and the transport.
- **NodeDB-Lite embedding** — the same `NodeDb` trait backs Lite; Studio could
  embed an in-process database for offline/demo use with no UI changes.
- **Streaming** — when `supports_streaming` is exploited, large reads and the
  monitor move from request/response to incremental delivery.
