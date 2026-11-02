//! 仕分けと物差しの受け口（/api/classify・/api/scale・/api/classes）を、試験のロットで確かめる。
//! - 分類が「穴」の画像を 3 枚見本にすると、条件に「分類 = 穴」が入り、ほかの「穴」の画像が当てはまる（ほかの分類は当てはまらない）
//! - 見本が 2 枚なら、条件を作らず「あと 1 枚」と返す
//! - 物差しは、欠陥データの幅・長さと画像の上の欠陥の大きさから推定する（試験のロット: 幅 1.2 mm・長さ 2.5 mm と、欠陥の四角）。
//!   合わせた値（設備ごと）があれば、それを先に使う
//! - グループは作業場所の classes.json に残る

use dt_core::app::App;
use dt_core::config::Config;
use serde_json::{json, Value};

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

fn call(app: &App, method: &str, path: &str, q: &[(&str, &str)], body: Value) -> Value {
    let query: Vec<String> = q.iter().map(|(k, v)| format!("{k}={}", enc(v))).collect();
    let b = if body.is_null() { vec![] } else { serde_json::to_vec(&body).unwrap() };
    let r = app.handle(method, path, &query.join("&"), &b).unwrap_or_else(|| panic!("答えが無い: {path}"));
    assert_eq!(r.status, 200, "{path}: {}", String::from_utf8_lossy(&r.body));
    serde_json::from_slice(&r.body).unwrap()
}

#[test]
fn three_examples_of_a_kind_find_the_rest_of_it() {
    let root = std::env::temp_dir().join(format!("dt-classify-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let lots = xtask::fixture::golden_tree(&root);
    let lot = lots[0].to_string_lossy().replace('\\', "/");
    let cfg = Config::from_value(json!({"equipments": [{"name": "LS3", "path": root.join("LS3")}]}), &root.join("_home"));
    let app = App::new(cfg, None);
    call(&app, "POST", "/api/open", &[], json!({"lot": lot}));
    // 画像 → 分類名（対応付け）
    let m = call(&app, "GET", "/api/imgmap", &[("lot", &lot), ("g", "img")], Value::Null);
    let map = m["map"].as_object().unwrap();
    let of = |kind: &str| -> Vec<String> {
        let mut v: Vec<String> = map.iter().filter(|(_, x)| x["kname"] == kind).map(|(k, _)| k.clone()).collect();
        v.sort();
        v
    };
    let holes = of("穴");
    assert!(holes.len() >= 4, "試験のロットに穴の画像が 4 枚以上ある: {holes:?}");
    let feat = |key: &str| {
        let (cab, name) = key.split_once('/').unwrap();
        call(&app, "GET", "/api/classify/feat", &[("lot", &lot), ("g", "img"), ("cab", cab), ("name", name)], Value::Null)
    };
    let f0 = feat(&holes[0]);
    assert!(f0["feat"]["img:area"].as_f64().unwrap() > 0.0 && f0["blob"].is_array(), "画像の欠陥が見つかる: {f0}");

    // 見本 2 枚: 条件を作らず、あと何枚かを返す
    let two: Vec<Value> = holes[..2].iter().map(|k| json!({"feat": feat(k)["feat"]})).collect();
    let r = call(&app, "POST", "/api/classify", &[], json!({"lot": lot, "g": "img", "groups": [{"id": "a", "examples": two}]}));
    assert!(r["groups"][0]["rules"].as_array().unwrap().is_empty() && r["groups"][0]["why"].as_str().unwrap().contains("あと 1 枚"), "{r}");

    // 見本 3 枚: 条件に分類＝穴が入り、ほかの穴が当てはまる・ほかの分類は当てはまらない
    let three: Vec<Value> = holes[..3].iter().map(|k| json!({"feat": feat(k)["feat"]})).collect();
    let r = call(&app, "POST", "/api/classify", &[], json!({"lot": lot, "g": "img", "groups": [{"id": "a", "examples": three}]}));
    let rules = r["groups"][0]["rules"].as_array().unwrap();
    assert!(rules.iter().any(|x| x["text"].as_str().unwrap().contains("= 穴")), "分類＝穴が決め手: {rules:?}");
    let hits: Vec<&String> = r["assign"].as_object().unwrap().iter().filter(|(_, a)| a["hit"] == true).map(|(k, _)| k).collect();
    assert!(holes.iter().all(|h| hits.contains(&h)), "穴は全部当てはまる: {hits:?} / {holes:?}");
    assert!(hits.iter().all(|h| holes.contains(h)), "穴でない画像は当てはまらない: {hits:?}");

    // 物差し: 推定（幅 1.2 mm ÷ 欠陥の幅 px・長さ 2.5 mm ÷ 欠陥の長さ px）→ 合わせた値が先 → 消すと推定に戻る
    let s = call(&app, "GET", "/api/scale", &[("lot", &lot), ("g", "img"), ("eq", "LS3")], Value::Null);
    assert_eq!(s["from"], "estimate", "{s}");
    let px = f0["blob"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect::<Vec<_>>();
    let (bw, bh) = (px[2] - px[0] + 1.0, px[3] - px[1] + 1.0);
    assert!(
        (s["x"].as_f64().unwrap() - 1.2 / bw).abs() < 1e-9 && (s["y"].as_f64().unwrap() - 2.5 / bh).abs() < 1e-9,
        "{s} / 欠陥 {bw}×{bh} px"
    );
    call(&app, "POST", "/api/scale", &[], json!({"eq": "LS3", "x": 0.05, "y": 0.2}));
    let s = call(&app, "GET", "/api/scale", &[("lot", &lot), ("g", "img"), ("eq", "LS3")], Value::Null);
    assert_eq!((s["from"].as_str(), s["x"].as_f64(), s["y"].as_f64()), (Some("calib"), Some(0.05), Some(0.2)));
    call(&app, "POST", "/api/scale", &[], json!({"eq": "LS3", "x": null}));
    assert_eq!(call(&app, "GET", "/api/scale", &[("lot", &lot), ("g", "img"), ("eq", "LS3")], Value::Null)["from"], "estimate");

    // グループは作業場所に残る
    call(&app, "POST", "/api/classes", &[], json!({"groups": [{"id": "a", "name": "穴", "examples": []}]}));
    assert_eq!(call(&app, "GET", "/api/classes", &[], Value::Null)["groups"][0]["name"], "穴");
    let _ = std::fs::remove_dir_all(&root);
}
