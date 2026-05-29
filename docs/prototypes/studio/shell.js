/* ============================================================
   NodeDB Studio mockup — shared shell (THROWAWAY)
   Builds sidebar + topbar + statusbar around each page's <main>
   content, so all pages share one consistent chrome. Loaded via
   <script src> (works on file://). Each page sets:
     <body data-screen="query" data-title="Query Editor">
   ============================================================ */
(function () {
  // ---- icons (16x16, currentColor) ----
  const I = {
    connections: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><circle cx="7" cy="7" r="0.5"/><circle cx="7" cy="17" r="0.5"/></svg>',
    query: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 8 10 12 6 16"/><line x1="13" y1="16" x2="18" y2="16"/></svg>',
    data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/></svg>',
    collections: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
    graph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><line x1="8" y1="7.5" x2="16" y2="7.5"/><line x1="7" y1="8" x2="8.5" y2="15.5"/></svg>',
    vectors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="7" r="1.4"/><circle cx="10" cy="12" r="1.4"/><circle cx="7" cy="17" r="1.4"/><circle cx="15" cy="9" r="1.4"/><circle cx="18" cy="15" r="1.4"/><circle cx="14" cy="16" r="1.4"/></svg>',
    monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 13 7 13 9 7 12 17 15 11 17 13 21 13"/></svg>',
    sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9a8 8 0 0 1 14-3l2 2"/><path d="M20 15a8 8 0 0 1-14 3l-2-2"/><polyline points="20 4 20 8 16 8"/><polyline points="4 20 4 16 8 16"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.6h-4l-.3 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/></svg>',
  };

  const CONNECTIONS = [
    { name: "local-lite",     host: "localhost:5432", status: "ok" },
    { name: "staging-origin", host: "stg.nodedb.dev:5432", status: "ok" },
    { name: "prod-origin",    host: "db.nodedb.dev:5432", status: "off" },
  ];
  let ACTIVE = 0;

  const NAV = [
    { id: "connections", label: "Connections", href: "index.html",          icon: I.connections },
    { id: "query",       label: "Query Editor", href: "query-editor.html",   icon: I.query },
    { id: "data",        label: "Data Browser", href: "data-browser.html",   icon: I.data },
    { id: "collections", label: "Collections",  href: "collections.html",    icon: I.collections },
    { id: "graph",       label: "Graph Explorer", href: "graph-explorer.html", icon: I.graph },
    { id: "vectors",     label: "Vector Viewer", href: "vector-viewer.html",  icon: I.vectors },
    { id: "monitor",     label: "Monitor",      href: "monitor.html",        icon: I.monitor },
    { id: "sync",        label: "Sync",         href: "sync.html",           icon: I.sync },
  ];

  const CAPS = [
    ["vector",1],["graph",1],["document",1],["fts",1],
    ["columnar",1],["timeseries",1],["crdt",0],["spatial",0],
  ];

  // ---- theme ----
  function applyTheme(t){ document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("ndb-theme", t); } catch(e){} }
  applyTheme((function(){ try { return localStorage.getItem("ndb-theme"); } catch(e){} }() ) || "dark");

  function el(html){ const d=document.createElement("div"); d.innerHTML=html.trim(); return d.firstElementChild; }

  document.addEventListener("DOMContentLoaded", function () {
    const screen = document.body.dataset.screen || "";
    const title  = document.body.dataset.title  || "";

    // hoist page content into <main class="screen">
    const main = document.createElement("main");
    main.className = "screen";
    while (document.body.firstChild) main.appendChild(document.body.firstChild);

    const conn = CONNECTIONS[ACTIVE];

    // ---- sidebar ----
    const navHtml = NAV.map(n =>
      `<a class="nav-item ${n.id===screen?"active":""}" href="${n.href}">${n.icon}<span class="lbl">${n.label}</span></a>`
    ).join("");

    const menuHtml = CONNECTIONS.map((c,i) =>
      `<div class="it" data-i="${i}"><span class="d ${c.status==="off"?"off":""}"></span><span>${c.name}</span><span class="host">${c.host}</span></div>`
    ).join("") + `<div class="it add">+ New connection…</div>`;

    const side = el(`
      <aside class="side">
        <div class="brand"><span class="mark">N</span><span>Studio</span><small>· NodeDB</small></div>
        <div class="conn-switch">
          <div class="cs-btn" id="csBtn">
            <span class="d ${conn.status==="off"?"off":""}"></span>
            <span class="nm">${conn.name}</span>
            <span class="chev">▾</span>
          </div>
          <div class="cs-menu hidden" id="csMenu">${menuHtml}</div>
        </div>
        <nav>
          <div class="grp-label">Workspace</div>
          ${navHtml}
        </nav>
        <div class="side-foot">
          <div class="sf-btn" id="themeBtn">${I.sun}<span>Theme</span></div>
          <div class="sf-btn" id="settingsBtn">${I.gear}<span>Settings</span></div>
        </div>
      </aside>`);

    // ---- topbar + statusbar ----
    const capsHtml = CAPS.map(([n,on]) =>
      `<span class="badge ${on?"cap-on":"cap-off"}">${n}</span>`).join(" ");

    const content = el(`
      <div class="content">
        <header class="topbar">
          <div class="crumbs">
            <span>${conn.name}</span><span class="sep">/</span><b>${title}</b>
          </div>
          <div class="spacer"></div>
          <div class="row faint" style="font-size:11.5px">Origin 0.1.0-dev · proto v3</div>
        </header>
        <footer class="statusbar">
          <span class="dot ok"></span><span>connected · ${conn.host}</span>
          <span class="sep faint">·</span>
          <span class="caps">${capsHtml}</span>
          <span class="spacer"></span>
          <span id="statusRight" class="faint">ready</span>
        </footer>
      </div>`);

    // insert main between topbar and statusbar
    content.insertBefore(main, content.querySelector(".statusbar"));

    const app = el(`<div class="app"></div>`);
    app.append(side, content);
    document.body.appendChild(app);

    // ---- wiring ----
    const csBtn = side.querySelector("#csBtn"), csMenu = side.querySelector("#csMenu");
    csBtn.addEventListener("click", () => csMenu.classList.toggle("hidden"));
    csMenu.querySelectorAll(".it[data-i]").forEach(it =>
      it.addEventListener("click", () => {
        ACTIVE = +it.dataset.i; const c = CONNECTIONS[ACTIVE];
        csBtn.querySelector(".nm").textContent = c.name;
        csBtn.querySelector(".d").className = "d" + (c.status==="off"?" off":"");
        content.querySelector(".crumbs span").textContent = c.name;
        content.querySelector(".statusbar span:nth-child(2)").textContent = "connected · " + c.host;
        csMenu.classList.add("hidden");
      }));
    document.addEventListener("click", e => {
      if (!side.querySelector(".conn-switch").contains(e.target)) csMenu.classList.add("hidden");
    });
    side.querySelector("#themeBtn").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      applyTheme(cur === "dark" ? "light" : "dark");
    });
  });
})();
