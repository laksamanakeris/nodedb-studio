//! Streams · LISTEN/NOTIFY: channel list + a live pub/sub tail.

use dioxus::prelude::*;

#[component]
pub fn StreamsNotify() -> Element {
    // (channel, listeners, active?)
    let channels = [
        ("user_events", "12", true),
        ("deploy_hooks", "3", false),
        ("cache_invalidate", "5", false),
        ("alerts", "8", false),
        ("jobs_done", "14", false),
        ("presence_room_1", "22", false),
    ];
    // (time, source, payload)
    let rows = [
        ("04:23:18.041", "api-server-2", "{\"event\":\"login\",\"user\":\"u_44182\"}"),
        ("04:23:17.812", "webhook-relay", "{\"event\":\"signup\",\"user\":\"u_99001\",\"plan\":\"pro\"}"),
        ("04:23:17.501", "api-server-1", "{\"event\":\"profile_update\",\"user\":\"u_77103\"}"),
        ("04:23:16.998", "analytics", "{\"event\":\"page_view\",\"user\":\"u_44182\",\"path\":\"/pricing\"}"),
        ("04:23:16.422", "api-server-2", "{\"event\":\"logout\",\"user\":\"u_31001\"}"),
    ];
    rsx! {
        div { style: "display: grid; grid-template-columns: 260px 1fr; overflow: hidden;",
            div { style: "background: var(--bg-secondary); border-right: 0.5px solid var(--border-mid); padding: 10px;",
                div { class: "eyebrow", style: "padding: 6px 10px;", "Channels (14)" }
                for (name, count, active) in channels {
                    div { class: if active { "collection active" } else { "collection" },
                        span { class: "ico", "#" }
                        " {name} "
                        span { class: "count", "{count}" }
                    }
                }
            }
            div { class: "live-tail",
                div { class: "tail-toolbar",
                    strong { style: "font-size:13px;", "user_events" }
                    span { class: "pill info", span { class: "dot" } "12 listeners" }
                    div { style: "margin-left:auto; display:flex; gap:6px;",
                        input {
                            placeholder: "payload filter",
                            style: "padding:4px 8px; background: var(--bg-primary); border: 0.5px solid var(--border-mid); border-radius: 4px; font-family: var(--font-mono); font-size: 11px;",
                        }
                        button { class: "btn small", "Send NOTIFY" }
                    }
                }
                div { class: "tail-body",
                    for r in rows {
                        div { class: "tail-row",
                            span { class: "time", "{r.0}" }
                            span { class: "op ins", "NOTIFY" }
                            span { class: "coll", "{r.1}" }
                            span { class: "payload", "{r.2}" }
                        }
                    }
                }
                div { class: "tail-footer",
                    span { class: "tail-pulse" }
                    span { "following" }
                    span { "throughput: 84 msg/s" }
                    span { "since: 04:18:00" }
                }
            }
        }
    }
}
