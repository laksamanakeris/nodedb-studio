# NodeDB Studio — Implementation Roadmap

**Date:** 2026-05-29
**Status:** Approved (planning)

NodeDB Studio is a Dioxus GUI client for NodeDB: query editor, data browser,
and administration. This document sequences the eight planned features into
dependency-ordered phases. Each phase gets its own spec → implementation plan →
build cycle. Phase 0 is designed in detail in
`2026-05-29-phase-0-foundation-design.md`.

## Platform decision: desktop-first

The plan commits to **desktop-only** for now. Web is deferred entirely.

Rationale — the web target is not buildable today:

- `NodeDbRemote` connects over pgwire via `tokio-postgres` (raw TCP).
- The `native` client connects over MessagePack via `tokio-rustls` (also raw TCP).
- A Dioxus web build compiles to WASM running in the browser, which has **no
  raw TCP sockets**. Neither transport can open a connection from the browser.

Web therefore requires a WebSocket/HTTP transport that does not exist in the
`nodedb-client` crate. Until that exists, web cannot connect to a NodeDB
instance. Desktop works today against `NodeDbRemote`. Revisit web when a
browser-compatible transport ships.

## Client surface we build on

From `nodedb-client` (the `NodeDb` trait + `NodeDbRemote`) and `nodedb-types`:

- Connection: `NodeDbRemote::connect(conn_string)` (pgwire).
- Typed ops: `vector_search/insert/delete`, `graph_traverse/insert_edge/
  delete_edge/stats/pagerank/shortest_path`, `document_get/put/delete` (+ bitemporal
  `*_as_of` / `*_with_valid_time`), `text_search`, named vector fields, batch ops.
- Escape hatch: `execute_sql(query, params) -> QueryResult{columns, rows, rows_affected}`.
- Collection lifecycle: `undrop_collection`, `drop_collection_purge`,
  `list_dropped_collections`.
- Handshake metadata: `capabilities()` (bitfield), `server_version()`, `limits()`,
  `proto_version()`.
- Capability bits: `streaming`, `graphrag`, `fts`, `crdt`, `spatial`,
  `timeseries`, `columnar`.

## Phases

### Phase 0 — Foundation (everything depends on this)

App shell + routing, **connection manager (multi-connection)**, async bridge
(Dioxus ↔ tokio ↔ `Arc<dyn NodeDb>`), result grid + `Value` rendering, and
capability gating. Ends with a demoable tracer-bullet slice: add connection →
connect → run raw SQL → see results in a grid.

Note: "Multi-connection" is README feature #8 but is foundational, not final —
every other feature needs a live, switchable `Arc<dyn NodeDb>`. It lands here.

Detailed design: `2026-05-29-phase-0-foundation-design.md`.

### Phase 1 — Core usable tool

Thin layers over the Phase 0 foundation.

- **Query editor** — SQL editor with syntax highlighting, autocomplete, and
  query history, over `execute_sql` + the result grid. (Phase 0 ships only a
  raw SQL box; this adds the editor affordances.)
- **Collection management** — create / alter / drop / inspect collections across
  engines. DDL through `execute_sql`; soft-delete/undrop/purge through the
  lifecycle methods.
- **Data browser** — browse, filter, and edit documents, vectors, graph nodes,
  timeseries, and KV pairs.
  - Risk: pgwire is documented as "read-mostly". Generic row editing across all
    engines is non-trivial. Browse/filter (read) is straightforward; **edit**
    scope must be pinned down per engine during Phase 1 brainstorming.

### Phase 2 — Specialized visualizers

- **Graph explorer** — interactive visualization of relationships and traversal
  results, over `graph_traverse` / `graph_pagerank` / `graph_shortest_path` /
  `graph_stats`. Needs a graph layout/rendering approach (force-directed).
- **Vector space viewer** — 2D/3D projection of vector collections with cluster
  visualization.
  - Risk: there is **no server-side projection API**. Dimensionality reduction
    (PCA/UMAP/t-SNE) must run client-side over vectors pulled via SQL/typed
    reads. Cost/feasibility for large collections must be scoped.

### Phase 3 — Operational dashboards (highest risk — gated by an API spike)

- **Real-time monitor** — live metrics, active queries, CDC streams, resource usage.
- **Sync dashboard** — CRDT sync status, pending deltas, conflict resolution,
  device overview.
  - Risk: there are **no typed client methods** for active queries, CDC streams,
    resource usage, or CRDT sync state. These depend on `_system.*` tables or
    `SHOW` commands existing server-side, which is unverified. **Before
    committing Phase 3, run an API-availability spike** against a live NodeDB to
    confirm what is queryable. Parts may be unbuildable until the server/client
    exposes them.

## Cross-cutting principles

- **Capability gating** — the UI hides or disables features for engines a server
  does not advertise (via the handshake bitfield). Established in Phase 0, used
  by every later phase so Studio degrades gracefully.
- **No silent failures** — `NodeDbError` (with SQLSTATE detail) surfaces in the
  UI; empty results never mask errors.
- **Credentials** — passwords live in the OS keychain (`keyring`); only
  non-secret connection fields are written to the config file.

## Open risks summary

| Risk | Phase | Mitigation |
|------|-------|------------|
| Web transport gap (no TCP in browser) | All | Desktop-first; defer web until a WASM transport exists |
| Data-browser edit across engines (pgwire read-mostly) | 1 | Pin edit scope per engine during Phase 1 design |
| No server-side vector projection API | 2 | Client-side dimensionality reduction; scope cost |
| No typed API for monitor / sync state | 3 | API-availability spike before committing Phase 3 |
