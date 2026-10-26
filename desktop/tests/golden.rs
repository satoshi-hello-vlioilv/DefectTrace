//! 正解データとの突き合わせ（評価関数）: 版 3.8 の Python 版（Flask）が、同じ試験のロットに返した答え（golden.json）と、
//! Rust の答えが同じか。試験のロットは program/tests/fixture_lot.py が毎回同じ物を作る。正解データの作り方は program/tests/make_golden.py。
//!
//! 同じとみなすこと: 数は 1e-9 の差まで・無い鍵と null。違ってよいと決めたこと（版 4.0.0）:
//! - /api/status: 縮小画像の進み（thumbs など）を足した。elapsed は比べない
//! - 画像の読み込み方を変えた（作業場所に原寸を書かない）ので、/img は中身の指紋で比べる

use dt_core::app::App;
use dt_core::config::Config;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

fn fixture(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("dt-golden-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let py = std::env::var("DT_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let st = Command::new(py)
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixture_lot.py"))
        .arg(&root)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .output()
        .expect("python で試験のロットを作れません（DT_PYTHON）");
    assert!(st.status.success(), "{}", String::from_utf8_lossy(&st.stderr));
    root
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// 数は差 1e-9 まで、無い鍵は null と同じ。違う所の道筋を返す。
fn diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            if (x - y).abs() > 1e-9 * x.abs().max(1.0) {
                out.push(format!("{path}: {x} ≠ {y}"));
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                let (p, q) = (x.get(k).unwrap_or(&Value::Null), y.get(k).unwrap_or(&Value::Null));
                diff(&format!("{path}.{k}"), p, q, out);
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{path}: 長さ {} ≠ {}", x.len(), y.len()));
            }
            for (i, (p, q)) in x.iter().zip(y).enumerate() {
                diff(&format!("{path}[{i}]"), p, q, out);
            }
        }
        _ if a != b => out.push(format!("{path}: {} ≠ {}", short(a), short(b))),
        _ => {}
    }
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    s.chars().take(120).collect()
}

fn norm(v: &Value, root: &str) -> Value {
    match v {
        Value::String(s) => json!(s.replace(root, "<ROOT>")),
        Value::Array(a) => Value::Array(a.iter().map(|x| norm(x, root)).collect()),
        Value::Object(m) => Value::Object(m.iter().map(|(k, x)| (k.replace(root, "<ROOT>"), norm(x, root))).collect()),
        x => x.clone(),
    }
}

#[test]
fn answers_match_the_python_version() {
    let root = fixture("answers");
    let rs = root.display().to_string();
    let home = root.join("_home");
    let cfg = Config::from_value(
        json!({"equipments": [{"name": "LS3", "path": format!("{rs}/LS3")}, {"name": "DL2", "path": format!("{rs}/DL2")}, {"name": "NS1", "path": format!("{rs}/NS1")}],
               "workers": 4}),
        &home,
    );
    let app = App::new(cfg, None);
    let golden: Vec<Value> = serde_json::from_str(include_str!("golden.json")).unwrap();
    let mut new_id = String::new();
    let mut problems = vec![];
    for g in &golden {
        let method = g["method"].as_str().unwrap();
        let url = g["url"].as_str().unwrap().replace("<ROOT>", &rs).replace("/api/pins/NEW", &format!("/api/pins/{new_id}"));
        let (path, q) = url.split_once('?').unwrap_or((&url, ""));
        let query: Vec<String> = q
            .split('&')
            .filter(|s| !s.is_empty())
            .map(|kv| {
                let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
                format!("{}={}", enc(k), enc(v))
            })
            .collect();
        let body = serde_json::to_vec(&norm(&g["req"], "<ROOT>").to_string().replace("<ROOT>", &rs).parse::<Value>().unwrap()).unwrap();
        let body = if g["req"].is_null() { vec![] } else { body };
        // 開いたら、画像の名前と縮小画像が済むまで待つ（版 3.8 の展開を待つのと同じ）
        let r = app.handle(method, path, &query.join("&"), &body).unwrap_or_else(|| panic!("答えが無い: {method} {url}"));
        if path == "/api/open" {
            let lot = g["req"]["lot"].as_str().unwrap().replace("<ROOT>", &rs);
            let job = app.images.job(Path::new(&lot), false).unwrap();
            for _ in 0..600 {
                if job.status()["finished"] == true {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }
        let what = format!("{method} {}", g["url"].as_str().unwrap());
        if r.status as u64 != g["status"].as_u64().unwrap() {
            problems.push(format!("{what}: 状態 {} ≠ {}（{}）", r.status, g["status"], String::from_utf8_lossy(&r.body)));
            continue;
        }
        if let Some(sha) = g["sha256"].as_str() {
            use sha2::Digest;
            let got = format!("{:x}", sha2::Sha256::digest(&r.body));
            if got != sha {
                problems.push(format!("{what}: 画像の中身が違う"));
            }
            continue;
        }
        let mut got: Value = serde_json::from_slice(&r.body).unwrap();
        got = norm(&got, &rs);
        let mut want = g["body"].clone();
        if path == "/api/status" {
            for k in ["thumbs", "thumbs_total", "named", "elapsed"] {
                got.as_object_mut().unwrap().remove(k);
            }
            for c in got["cabs"].as_array_mut().unwrap() {
                c.as_object_mut().unwrap().remove("thumbs");
                c.as_object_mut().unwrap().remove("working");
            }
        }
        if method == "POST" && path == "/api/pins" && r.status == 200 {
            if let Some(p) = got.as_array().unwrap().iter().find(|p| p["key"] == "product") {
                new_id = p["id"].as_str().unwrap().to_string();
            }
        }
        if path.starts_with("/api/pins") {
            // 新しい項目の id は作るたびに違う
            for v in [&mut got, &mut want] {
                if let Some(a) = v.as_array_mut() {
                    for p in a {
                        if p["id"].as_str().is_some_and(|i| i == new_id || i == "NEW" || i.starts_with("p_")) {
                            p["id"] = json!("NEW");
                        }
                    }
                }
            }
        }
        let mut d = vec![];
        diff("", &got, &want, &mut d);
        if !d.is_empty() {
            problems.push(format!("{what}:\n    {}", d.iter().take(8).cloned().collect::<Vec<_>>().join("\n    ")));
        }
    }
    let _ = std::fs::remove_dir_all(&root);
    assert!(problems.is_empty(), "{} 件が版 3.8 と違う:\n{}", problems.len(), problems.join("\n"));
}

/// 原寸を先に開いた CAB でも、画像ごとの XML が画像情報に出る（版 4.0.0 で作った後の採点が見つけた後戻りの試験）。
#[test]
fn image_xml_is_kept_when_the_original_is_opened_first() {
    let root = fixture("xml");
    let rs = root.display().to_string();
    let app = App::new(Config::from_value(json!({"workers": 2}), &root.join("_home")), None);
    let lot = format!("{rs}/LS3/2026/2026_10/2026_10_25/2026_10_25_22_03_53");
    let q = |name: &str| format!("lot={}&g=img&cab=0002&name={}", enc(&lot), enc(name));
    // 裏の仕事より先に、後ろの CAB の原寸を開く
    let r = app.handle("GET", "/img", &q("16.bmp"), &[]).unwrap();
    assert_eq!(r.status, 200);
    let body = serde_json::to_vec(&json!({"lot": lot})).unwrap();
    app.handle("POST", "/api/open", "", &body).unwrap();
    let job = app.images.job(Path::new(&lot), false).unwrap();
    for _ in 0..600 {
        if job.status()["finished"] == true {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert_eq!(job.status()["thumbs"], job.status()["thumbs_total"], "済んだと言うときは全部そろっている");
    let info: Value = serde_json::from_slice(&app.handle("GET", "/api/imginfo", &q("16.bmp"), &[]).unwrap().body).unwrap();
    let names: Vec<&str> = info["xml"].as_array().unwrap().iter().map(|x| x["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["0002.cab/16_info.xml"], "{info}");
    let _ = std::fs::remove_dir_all(&root);
}
