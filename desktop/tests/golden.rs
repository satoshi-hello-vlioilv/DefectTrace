//! 正解データとの突き合わせ（評価関数）: 版 3.8 の Python 版（Flask）が、同じ試験のロットに返した答え（golden.json）と、
//! Rust の答えが同じか。試験のロットは program/tests/fixture_lot.py が毎回同じ物を作る。正解データの作り方は program/tests/make_golden.py。
//!
//! 同じとみなすこと: 数は 1e-9 の差まで・無い鍵と null。違ってよいと決めたこと（版 4.0.0）:
//! - /api/status: 縮小画像の進み（thumbs など）を足した。elapsed は比べない
//!   （版 4.0.1: 開くは名前を待たずに返る。golden の流れは finished まで待ってから問うので、答えは変わらない。brief=1 は別の試験）
//! - 画像の読み込み方を変えた（作業場所に原寸を書かない）ので、/img は中身の指紋で比べる
//! 違ってよいと決めたこと（版 4.8.0。利用者の依頼）:
//! - 既定の表示項目の一覧（list）に材質（d_list_mat）と欠陥数（d_list_dc）を足した（V48_ADDED）。/api/pins の答えと
//!   ロットの情報・一覧の items など、答えのどこに出ても、この 2 つを除いて比べる
//! - ロット一覧の印（flags）に no_image（画像なし: 画像総数が 0）を足した。除いて比べる

use dt_core::app::App;
use dt_core::config::Config;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

/// 版 4.8.0 で既定の表示項目に足した物（版 3.8 には無い）
const V48_ADDED: [&str; 2] = ["d_list_mat", "d_list_dc"];

/// 答えの木から、版 4.8.0 で足した物（V48_ADDED の表示項目・no_image の印）を除く。
fn without_v48(v: &mut Value) {
    match v {
        Value::Array(a) => {
            a.retain(|x| !V48_ADDED.contains(&x["id"].as_str().unwrap_or("")));
            a.iter_mut().for_each(without_v48);
        }
        Value::Object(o) => {
            o.remove("no_image");
            o.values_mut().for_each(without_v48);
        }
        _ => {}
    }
}

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

/// 値の木の中の文字（鍵も）を f で変える。
fn map_str(v: &Value, f: &dyn Fn(&str) -> String) -> Value {
    match v {
        Value::String(s) => json!(f(s)),
        Value::Array(a) => Value::Array(a.iter().map(|x| map_str(x, f)).collect()),
        Value::Object(m) => Value::Object(m.iter().map(|(k, x)| (f(k), map_str(x, f))).collect()),
        x => x.clone(),
    }
}

/// 値の木の中の from を to に置き換える（JSON の文字にしてから置き換えると、Windows の場所の \ が壊れる）。
fn swap(v: &Value, from: &str, to: &str) -> Value {
    map_str(v, &|s| s.replace(from, to))
}

/// 「開けません: 場所 (理由)」の理由は OS の言葉（Windows と Linux で違う）なので、比べる前に同じ印にする。
fn os_reason(v: &Value) -> Value {
    map_str(v, &|s| match (s.starts_with("開けません: "), s.rfind(" (")) {
        (true, Some(i)) if s.ends_with(')') => format!("{} (<OS の理由>)", &s[..i]),
        _ => s.to_string(),
    })
}

#[test]
fn answers_match_the_python_version() {
    let root = fixture("answers");
    // 正解データは Linux で作った（区切りは /）。場所の区切りは OS の流儀なので、渡すのも比べるのも / にそろえる（Windows も / を読める）
    let rs = root.display().to_string().replace('\\', "/");
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
        let body = serde_json::to_vec(&swap(&g["req"], "<ROOT>", &rs)).unwrap();
        let body = if g["req"].is_null() { vec![] } else { body };
        // 開いたら、画像の名前と縮小画像が済むまで待つ（版 3.8 の展開を待つのと同じ）
        let r = app.handle(method, path, &query.join("&"), &body).unwrap_or_else(|| panic!("答えが無い: {method} {url}"));
        if path == "/api/open" {
            let lot = g["req"]["lot"].as_str().unwrap().replace("<ROOT>", &rs);
            let job = app.images.job(Path::new(&lot), false).unwrap();
            for _ in 0..600 {
                if job.status(false)["finished"] == true {
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
        got = os_reason(&swap(&swap(&got, "\\", "/"), &rs, "<ROOT>"));
        let mut want = os_reason(&g["body"]);
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
        // 版 4.8.0 で足した物（上の「違ってよいと決めたこと」）
        without_v48(&mut got);
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
        if job.status(false)["finished"] == true {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert_eq!(job.status(false)["thumbs"], job.status(false)["thumbs_total"], "済んだと言うときは全部そろっている");
    let info: Value = serde_json::from_slice(&app.handle("GET", "/api/imginfo", &q("16.bmp"), &[]).unwrap().body).unwrap();
    let names: Vec<&str> = info["xml"].as_array().unwrap().iter().map(|x| x["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["0002.cab/16_info.xml"], "{info}");
    let _ = std::fs::remove_dir_all(&root);
}

/// 開くは名前を待たずに返り、名前は裏で読む。読み込み中の問い合わせ（brief）は名前を省いて数だけを返す。
/// 開き直すと、作業場所に残った縮小画像を拾い、作り直さずに済む（版 4.0.1: 数万枚のロットの読み込みの進みと速さ）。
#[test]
fn names_are_read_behind_and_brief_status_and_cache_reuse() {
    let root = fixture("brief");
    let rs = root.display().to_string();
    let lot = format!("{rs}/LS3/2026/2026_10/2026_10_25/2026_10_25_22_03_53");
    let body = serde_json::to_vec(&json!({"lot": lot})).unwrap();
    let wait = |app: &App| {
        let job = app.images.job(Path::new(&lot), false).unwrap();
        for _ in 0..600 {
            if job.status(false)["finished"] == true {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        job
    };
    let app = App::new(Config::from_value(json!({"workers": 2}), &root.join("_home")), None);
    assert_eq!(app.handle("POST", "/api/open", "", &body).unwrap().status, 200);
    let job = wait(&app);
    let full = job.status(false);
    let brief: Value =
        serde_json::from_slice(&app.handle("GET", "/api/status", &format!("lot={}&brief=1", enc(&lot)), &[]).unwrap().body).unwrap();
    assert_eq!(full["named"], true);
    assert_eq!(brief["thumbs_total"], full["thumbs_total"]);
    for (f, b) in full["cabs"].as_array().unwrap().iter().zip(brief["cabs"].as_array().unwrap()) {
        assert!(b.get("images").is_none(), "brief は名前を省く: {b}");
        assert_eq!(b["n"].as_u64().unwrap() as usize, f["images"].as_array().unwrap().len(), "数は名前の数");
    }
    // 開き直し（窓を開き直したのと同じ。作業場所は同じ）: 縮小画像は前の物を使う
    let again = App::new(Config::from_value(json!({"workers": 2}), &root.join("_home")), None);
    let job = again.images.job(Path::new(&lot), false).unwrap();
    job.wait_named(std::time::Duration::from_secs(30));
    let st = job.status(false);
    assert_eq!(st["thumbs"], st["thumbs_total"], "前の縮小画像を拾う: {st}");
    assert_eq!(st["finished"], true, "作る物が残っていない");
    let _ = std::fs::remove_dir_all(&root);
}

/// リスト表示（版 4.2.0）: 木の節の下のロットを集め、ロット単位の列の目録と値を返す。値はロット情報（/api/info）の値と同じ作り方。
#[test]
fn lot_list_collects_lots_columns_and_values() {
    let root = fixture("lotlist");
    let rs = root.display().to_string();
    let app = App::new(Config::from_value(json!({"workers": 2}), &root.join("_home")), None);
    let get = |path: &str, q: &str| -> Value { serde_json::from_slice(&app.handle("GET", path, q, &[]).unwrap().body).unwrap() };
    let post = |path: &str, b: Value| -> Value {
        serde_json::from_slice(&app.handle("POST", path, "", &serde_json::to_vec(&b).unwrap()).unwrap().body).unwrap()
    };
    // 設備の節から（年・月・日をたどって）ロットを集める。新しい順
    let lots = get("/api/lots", &format!("path={}", enc(&format!("{rs}/LS3"))));
    let names: Vec<&str> = lots["lots"].as_array().unwrap().iter().map(|l| l["name"].as_str().unwrap()).collect();
    assert!(names.len() >= 2, "{lots}");
    let mut sorted = names.clone();
    sorted.sort_by(|a, b| b.cmp(a));
    assert_eq!(names, sorted, "新しい順");
    let paths: Vec<String> = lots["lots"].as_array().unwrap().iter().map(|l| l["path"].as_str().unwrap().to_string()).collect();
    // 列の目録: フォルダ名・確かめ・1 件の .dat の項目・条件の XML・分類別
    let cols = post("/api/lotcols", json!({"paths": paths}));
    let ids: Vec<&str> = cols.as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap()).collect();
    for want in ["@lot|lot", "@lot|date", "@check|overload", "dat:INSP_INFO|product"] {
        assert!(ids.contains(&want), "{want} が無い: {ids:?}");
    }
    assert!(ids.iter().any(|i| i.starts_with("cond/") || i.contains(".xml|")), "条件の XML の列: {ids:?}");
    assert!(ids.iter().any(|i| i.starts_with("@class|")), "分類別の列: {ids:?}");
    assert!(!ids.iter().any(|i| i.starts_with("dat:DETECT_INFO|")), "件数の多い .dat はロット単位の列にしない");
    // 値: ロット情報の答え（INSP_INFO の品名・多量の数・分類の合計）と同じ
    let want_cols = json!([{"file": "@lot", "key": "lot"}, {"file": "dat:INSP_INFO", "key": "product"}, {"file": "@check", "key": "overload"}, {"file": "@check", "key": "defects"}]);
    let rows = post("/api/lotrows", json!({"paths": paths, "cols": want_cols}));
    for p in &paths {
        let info = get("/api/info", &format!("lot={}", enc(p)));
        let v = rows[p].as_array().unwrap_or_else(|| panic!("{p}: {rows}"));
        assert_eq!(v[0], info["lot"], "ロットのフォルダ名");
        let insp = info["dat"].as_array().unwrap().iter().find(|d| d["name"] == "INSP_INFO").unwrap();
        let product = insp["fields"].as_array().unwrap().iter().find(|f| f[0] == "product").map(|f| f[1].clone()).unwrap_or(json!(""));
        assert_eq!(v[1], product, "{p}: 品名");
        assert_eq!(v[2], json!(info["overload"]["count"].as_i64().map(|n| n.to_string()).unwrap_or_default()), "{p}: 多量");
        let total: i64 = info["classes"]["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["total"].as_i64().unwrap_or_else(|| r["sides"].as_object().unwrap().values().filter_map(Value::as_i64).sum()))
            .sum();
        assert_eq!(v[3], json!(total.to_string()), "{p}: 分類の合計");
    }
    // 表示項目（サマリ・ロット情報・一覧）と同じ項目は、ロット表でも同じ値（単位の倍率・日時の形も同じ）。
    // 画面（lotlist-view.js の spec）は、列と同じファイル・鍵の表示項目の scale・fmt を付けて問い合わせる
    assert!(ids.contains(&"dat:INSP_INFO|@insp_width"), "計算で作る項目（検査幅）も列にする: {ids:?}");
    let pins = get("/api/pins", "");
    let lot_pins: Vec<&Value> = pins.as_array().unwrap().iter().filter(|p| p["scope"] == "lot").collect();
    let spec = |p: &Value| {
        let mut c = json!({"file": p["file"], "key": p["key"]});
        for k in ["scale", "fmt"] {
            if !p[k].is_null() {
                c[k] = p[k].clone();
            }
        }
        c
    };
    let rows = post("/api/lotrows", json!({"paths": paths, "cols": lot_pins.iter().map(|p| spec(p)).collect::<Vec<_>>()}));
    for p in &paths {
        let info = get("/api/info", &format!("lot={}", enc(p)));
        let shown = info["pinned"].as_array().unwrap();
        for (j, pin) in lot_pins.iter().enumerate() {
            let want = &shown.iter().find(|x| x["id"] == pin["id"]).unwrap()["value"];
            assert_eq!(&rows[p][j], want, "{p}: 「{}」がサマリ・ロット情報と同じ値", pin["label"]);
        }
    }
    // 単位: 検査長(m) は INSP_INFO.insp_end_y（mm）× 0.001。倍率を付けないと mm のまま（直す前のロット表はこちらで、桁が 1000 倍違った）
    let raw = post(
        "/api/lotrows",
        json!({"paths": [&paths[0]], "cols": [{"file": "dat:INSP_INFO", "key": "insp_end_y"}, {"file": "dat:INSP_INFO", "key": "insp_end_y", "scale": 0.001}]}),
    );
    let (mm, m) =
        (raw[&paths[0]][0].as_str().unwrap().parse::<f64>().unwrap(), raw[&paths[0]][1].as_str().unwrap().parse::<f64>().unwrap());
    assert!((mm * 0.001 - m).abs() < 0.01, "検査長: {mm} mm → {m} m");
    let bad = post("/api/lotrows", json!({"paths": [format!("{rs}/nothing")], "cols": want_cols}));
    assert!(bad[format!("{rs}/nothing")]["error"].is_string(), "読めないロットは error");
    let _ = std::fs::remove_dir_all(&root);
}
