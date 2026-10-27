//! 窓を使わずに画面を出す試しの入口（開発・画面の撮影 program/tools/ui-check.mjs・ブラウザでの確かめ）。
//!
//!     cargo run --release --example serve -- [--port 5050] [--config <config.json>] [--home <作業場所>] [--slow-ms 0]
//!
//! --slow-ms: 共有フォルダの遅さを真似る（欠陥データ・対応付けなど、ロットの .dat を読む問い合わせを、その分だけ遅らせて答える）。
//! 手元のディスクでは一瞬で済む「使えるようになるまで」の画面を撮るため（program/tools/open-check.mjs --slow-ms）。
//!
//! 画面の問い合わせは窓と同じ係（dt_core::app）が答える。窓だけが答えること（/__desktop/…）は、撮影に要る分だけ作り物で答える
//! （DT_FAKE_DESKTOP に JSON を渡すと、その中身で答える: {"update": {...}, "install": {...}, "release": {...}, "info": {...},
//! "shortcut": {made, problems}〈「作る」の答え〉, "shortcut_wait_ms": 答えるまで待つ}）。

use dt_core::app::{App, Reply};
use dt_core::config::Config;
use serde_json::{json, Value};
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |n: &str| args.iter().position(|a| a == n).and_then(|i| args.get(i + 1)).cloned();
    let port: u16 = arg("--port").and_then(|p| p.parse().ok()).unwrap_or(5050);
    let slow = std::time::Duration::from_millis(arg("--slow-ms").and_then(|p| p.parse().ok()).unwrap_or(0));
    let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
    let home = arg("--home").map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("dt-serve-home"));
    let cfg = match arg("--config") {
        Some(c) => {
            let v: Value = serde_json::from_slice(&std::fs::read(&c).expect("config を読めません")).expect("config の形が違います");
            Config::from_value(v, &home)
        }
        None => Config::load(Some(&program.join("config").join("config.json")), &home),
    };
    let app = App::new(cfg, Some(program.clone()));
    let version = dt_core::update::program_version(&program).unwrap_or_else(|| "dev".into());
    let fake: Value = std::env::var("DT_FAKE_DESKTOP").ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    let server = tiny_http::Server::http(("127.0.0.1", port)).expect("ポートを開けません");
    println!("http://127.0.0.1:{port}/  （作業場所 {}）", home.display());
    for mut req in server.incoming_requests() {
        let app = app.clone();
        let (static_dir, version, fake) = (program.join("app").join("static"), version.clone(), fake.clone());
        std::thread::spawn(move || {
            let url = req.url().to_string();
            let (path, query) = url.split_once('?').unwrap_or((&url, ""));
            let mut body = vec![];
            let _ = req.as_reader().read_to_end(&mut body);
            let method = req.method().as_str().to_string();
            if matches!(path, "/api/info" | "/api/imgmap") {
                std::thread::sleep(slow);
            }
            let reply = match (method.as_str(), path) {
                ("GET", "/__desktop/info") => Reply::json(
                    &json!({"version": version, "shell_version": version, "installed": false})
                        .as_object()
                        .map(|o| {
                            let mut o = o.clone();
                            if let Some(f) = fake["info"].as_object() {
                                o.extend(f.clone());
                            }
                            Value::Object(o)
                        })
                        .unwrap(),
                ),
                ("GET", "/__desktop/update") => Reply::json(&if fake["update"].is_null() {
                    json!({"state": "off", "current": version})
                } else {
                    fake["update"].clone()
                }),
                ("GET", "/__desktop/install") => Reply::json(&if fake["install"].is_null() {
                    json!({"installed": false, "shortcut": {"ask": false}})
                } else {
                    fake["install"].clone()
                }),
                ("GET", "/__desktop/release") => Reply::json(&if fake["release"].is_null() {
                    json!({"reachable": false, "why": "試しの入口", "versions": []})
                } else {
                    fake["release"].clone()
                }),
                ("POST", "/__desktop/shortcut") if !fake["shortcut"].is_null() => {
                    // 答えが返らない窓を真似る（shortcut_wait_ms。作れたかは /__desktop/install の links で尋ね直す）
                    std::thread::sleep(std::time::Duration::from_millis(fake["shortcut_wait_ms"].as_u64().unwrap_or(0)));
                    Reply::json(&fake["shortcut"])
                }
                (_, p) if p.starts_with("/__desktop/") => Reply::json(&json!({"ok": true})),
                _ => app.handle_all(&method, path, query, &body, &static_dir, &version),
            };
            let mut resp = tiny_http::Response::from_data(reply.body).with_status_code(reply.status);
            for (k, v) in reply.headers {
                if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
                    resp.add_header(h);
                }
            }
            let _ = req.respond(resp);
        });
    }
}
