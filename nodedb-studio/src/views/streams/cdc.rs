//! Streams · CDC: a live tail of change events. Payloads are data strings, so
//! their braces need no rsx escaping.

use dioxus::prelude::*;

#[component]
pub fn StreamsCdc() -> Element {
    // (time, op, op-css, collection, payload)
    let rows = [
        ("04:23:18.041", "INSERT", "ins", "events", "{ \"_id\": \"evt_01HMNJ…\", \"type\": \"page_view\", \"user_id\": \"u_44182\", \"props\": { \"path\": \"/dashboard\" } }"),
        ("04:23:18.039", "UPDATE", "upd", "sessions", "{ \"_id\": \"s_88209\", \"last_seen\": \"2026-06-13T04:23:18Z\" } ⤳ +1 field"),
        ("04:23:18.037", "INSERT", "ins", "events", "{ \"_id\": \"evt_01HMNJ…\", \"type\": \"click\", \"user_id\": \"u_77103\", \"props\": { \"el\": \"#cta-buy\" } }"),
        ("04:23:18.035", "INSERT", "ins", "orders", "{ \"id\": 442004, \"user_id\": \"u_77103\", \"total\": 89.40, \"currency\": \"USD\" }"),
        ("04:23:18.033", "DELETE", "del", "sessions_cache", "{ \"key\": \"session:u_91002\" }"),
        ("04:23:18.031", "INSERT", "ins", "events", "{ \"_id\": \"evt_01HMNJ…\", \"type\": \"scroll\", \"user_id\": \"u_12998\" }"),
        ("04:23:18.028", "UPDATE", "upd", "users", "{ \"_id\": \"u_44182\", \"last_login\": \"2026-06-13T04:23:18Z\" }"),
        ("04:23:18.025", "INSERT", "ins", "events", "{ \"_id\": \"evt_01HMNJ…\", \"type\": \"page_view\", \"user_id\": \"u_31001\", \"props\": { \"path\": \"/pricing\" } }"),
        ("04:23:18.022", "INSERT", "ins", "events", "{ \"_id\": \"evt_01HMNJ…\", \"type\": \"form_submit\", \"user_id\": \"u_44182\", \"props\": { \"form\": \"feedback\" } }"),
    ];
    rsx! {
        div { class: "live-tail",
            div { class: "tail-toolbar",
                strong { style: "font-size:13px;", "events_cdc" }
                span { class: "pill ok", span { class: "dot" } "live · 2,103 ev/s" }
                div { style: "margin-left:auto; display:flex; gap:6px; align-items:center;",
                    input {
                        placeholder: "filter: type=signup",
                        style: "padding:4px 8px; background: var(--bg-primary); border: 0.5px solid var(--border-mid); border-radius: 4px; font-family: var(--font-mono); font-size: 11px;",
                    }
                    button { class: "btn small", "Pause" }
                    button { class: "btn small", "⇣ Export" }
                }
            }
            div { class: "tail-body",
                for r in rows {
                    div { class: "tail-row",
                        span { class: "time", "{r.0}" }
                        span { class: "op {r.2}", "{r.1}" }
                        span { class: "coll", "{r.3}" }
                        span { class: "payload", "{r.4}" }
                    }
                }
            }
            div { class: "tail-footer",
                span { class: "tail-pulse" }
                span { "following tail" }
                span { "buffer: 9 / 5,000" }
                span { "lag from leader: 12 ms" }
                span { style: "margin-left:auto;", "columns: time, op, collection, payload" }
            }
        }
    }
}
