//! ロットの一覧（リスト表示）: 木の節の下のロットを集め、ロット単位で取れる値を列にして返す（全件を書き出すため）。
//!
//! - 列の目録（`columns`）: 見本のロット（いくつか）から、ロット単位で 1 つの値が決まる項目を集める
//!   - `@lot`: フォルダ名から分かる値（作業日・作業時刻・ロットのフォルダ名）
//!   - `dat:<名前>`: 1〜3 件の .dat の項目（先頭の 1 件。INSP_INFO など）
//!   - `<XML の場所の型>`: 条件などの XML の項目（ロット情報に出す物と同じ）
//!   - `@check`: 確かめ（多量・欠陥数上限・時刻の不一致）
//!   - `@class`: 分類別の欠陥数（分類 ID ごと。DETECT_INFO を読むので、選んだときだけ計算する）
//! - 値（`values`）: 選んだ列の値だけを、ロットごとに並べて作る（共有の読みを待つ間に次を進める。8 本まで）。
//!   値はロット情報・サマリ・一覧の表示項目と同じ作り方（lot::resolve_lot_pin）。数の整え方は画面（表示列）が決める

use crate::app::App;
use crate::dat;
use crate::lot::{self, name_of, LotRes};
use crate::lotstore;
use crate::pyfmt::natcmp;
use crate::xml;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

/// 木の節 `root` の下のロット（新しい順）。深さは `depth` 段まで（設備 > 年 > 年月 > 日 > ロット で 4 段）。
pub fn lots_under(root: &Path, lot_re: &Regex, depth: usize) -> Vec<PathBuf> {
    let mut out = vec![];
    walk(root, lot_re, depth, &mut out);
    out.sort_by(|a, b| natcmp(&name_of(b), &name_of(a)));
    out
}

fn walk(dir: &Path, lot_re: &Regex, depth: usize, out: &mut Vec<PathBuf>) {
    if lot_re.is_match(&name_of(dir)) {
        out.push(dir.to_path_buf());
        return;
    }
    if depth == 0 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut subs: Vec<PathBuf> =
        rd.flatten().filter(|e| e.file_type().map(|t| t.is_dir() || t.is_symlink()).unwrap_or(false)).map(|e| e.path()).collect();
    subs.sort();
    for s in subs {
        if s.is_dir() {
            walk(&s, lot_re, depth - 1, out);
        }
    }
}

/// 確かめの列（`@check`）。
pub const CHECKS: [(&str, &str); 5] = [
    ("overload", "多量（件）"),
    ("detect_max", "欠陥数上限"),
    ("time_warn", "時刻の不一致"),
    ("time_diff", "時刻の差（分）"),
    ("defects", "欠陥数（分類の合計）"),
];

/// 1 つの列の定義。
fn col(file: &str, key: &str, label: &str, group: &str) -> Value {
    json!({"id": format!("{file}|{key}"), "file": file, "key": key, "label": label, "group": group})
}

/// 1 つのロットから取れる列（並びは画面の「データ項目」と同じ: フォルダ名 → 確かめ → .dat → XML → 分類別）。
fn columns_of(res: &LotRes) -> Vec<Value> {
    let mut out = vec![col("@lot", "lot", "ロット（フォルダ名）", "フォルダ名")];
    out.extend(lot::LOT_META.iter().map(|(k, l)| col("@lot", k, l, "フォルダ名")));
    out.extend(CHECKS.iter().map(|(k, l)| col("@check", k, l, "確かめ")));
    // .dat（ロット直下・1〜3 件）。ロット情報のデータ項目と同じ選び方
    let mut dats: Vec<String> = res
        .rel
        .iter()
        .filter(|p| p.parent() == Some(res.lot.as_path()) && name_of(p).to_lowercase().ends_with(".dat"))
        .map(|p| {
            let n = name_of(p);
            n[..n.len() - 4].to_string()
        })
        .collect();
    dats.sort_by(|a, b| natcmp(a, b));
    for n in dats {
        // 件数は頭と大きさから数える（件数の多い DETECT_INFO〈数 MB〉を、列にしないのに読まない）
        if !res.find(&format!("{n}.dat")).and_then(|p| dat::count_records(&p)).is_some_and(|c| (1..=3).contains(&c)) {
            continue;
        }
        let d = res.dat(&n);
        if !(1..=3).contains(&d.records.len()) {
            continue;
        }
        // 計算で作る項目（検査幅など。表示項目と同じ鍵）を先に、元の欄をその後に
        for (k, l, _) in lot::virtuals_of(&d) {
            out.push(col(&format!("dat:{n}"), k, l, &format!("{n}.dat")));
        }
        for f in d.value_fields() {
            let label = if f.label.is_empty() { f.name.clone() } else { f.label.clone() };
            out.push(col(&format!("dat:{n}"), &f.name, &label, &format!("{n}.dat")));
        }
    }
    // 条件などの XML（ロット情報に出す物と同じ: 5MB 未満・定義の XML を除く）。場所は型（cond/COND*.xml など）で持つ
    let mut xmls: Vec<(String, PathBuf)> = res
        .rel
        .iter()
        .filter(|fp| {
            let low = name_of(fp).to_lowercase();
            low.ends_with(".xml")
                && !low.ends_with("def.xml")
                && low != "inspectdatainfo.xml"
                && std::fs::metadata(fp).map(|m| m.len() < 5_000_000).unwrap_or(false)
        })
        .map(|fp| (fp.strip_prefix(&res.lot).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default(), fp.clone()))
        .collect();
    xmls.sort_by(|a, b| {
        let ka = !a.0.to_lowercase().starts_with("cond/cond");
        let kb = !b.0.to_lowercase().starts_with("cond/cond");
        ka.cmp(&kb).then(natcmp(&a.0, &b.0))
    });
    for (rel, fp) in xmls {
        let labels = res.xml_labels_for(&rel);
        let g = xml::generalize(&rel);
        for (k, _) in xml::pairs(&fp).iter() {
            let l = xml::label_for(k, &labels);
            let short = k.rsplit('/').next().unwrap_or(k).to_string();
            out.push(col(&g, k, if l.is_empty() { &short } else { &l }, &rel));
        }
    }
    // 分類別の欠陥数（分類の定義から。値は選んだときだけ数える）
    for (k, kd) in res.kinds() {
        out.push(col("@class", k, &format!("{}（件）", kd.name), "分類別の欠陥数"));
    }
    out
}

/// 見本のロットの列を合わせる（先に見たロットの並びを保ち、後のロットにだけある列を後ろへ足す）。
pub fn columns(app: &App, paths: &[String]) -> Value {
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for p in paths {
        let Ok(res) = app.lots.get(p, &app.cfg, app.program.as_ref()) else { continue };
        for c in columns_of(&res) {
            if seen.insert(c["id"].as_str().unwrap_or("").to_string()) {
                out.push(c);
            }
        }
    }
    Value::Array(out)
}

/// 1 つのロットの、1 つの列の値。c は {file, key} に、表示項目（ピン）と同じ単位の倍率（scale）・日時の形（fmt）を足せる。
/// 値の作り方は表示項目と同じ（lot::resolve_lot_pin）。同じ項目なら、ロット表とサマリ・ロット情報で同じ値になる
pub fn value_of(res: &LotRes, c: &Value, cache: &mut BTreeMap<&'static str, Value>) -> String {
    let (file, key) = (c["file"].as_str().unwrap_or(""), c["key"].as_str().unwrap_or(""));
    match file {
        "@lot" if key == "lot" => name_of(&res.lot),
        "@check" => {
            let flags = cache.entry("flags").or_insert_with(|| lot::lot_flags(res));
            match key {
                "overload" => flags["overload"].as_i64().map(|n| n.to_string()).unwrap_or_default(),
                "detect_max" => match flags["detect_max_status"].as_i64() {
                    Some(0) => "なし".into(),
                    Some(1) => "最大数オーバー".into(),
                    Some(2) => "HDD容量オーバー".into(),
                    Some(n) => n.to_string(),
                    None => String::new(),
                },
                "time_warn" => match flags["time_warn"].as_bool() {
                    Some(true) => "不一致".into(),
                    Some(false) => "一致".into(),
                    None => String::new(),
                },
                "time_diff" => flags["time_max_diff"].as_f64().map(|v| lot::fmt_val(&crate::dat::V::F(v))).unwrap_or_default(),
                "defects" => {
                    let cs = cache.entry("classes").or_insert_with(|| lot::class_summary(res));
                    let n: i64 = cs["rows"].as_array().map(|rs| rs.iter().map(class_total).sum()).unwrap_or(0);
                    n.to_string()
                }
                _ => String::new(),
            }
        }
        "@class" => {
            let cs = cache.entry("classes").or_insert_with(|| lot::class_summary(res));
            cs["rows"].as_array().and_then(|rs| rs.iter().find(|r| r["kind"] == key)).map(class_total).unwrap_or(0).to_string()
        }
        _ => lot::resolve_lot_pin(res, c),
    }
}

/// 分類の欠陥数（INSP_INFO.classification_count があればそれ、無ければ DETECT_INFO の面ごとの数の和）。
fn class_total(r: &Value) -> i64 {
    r["total"].as_i64().unwrap_or_else(|| r["sides"].as_object().map(|m| m.values().filter_map(Value::as_i64).sum()).unwrap_or(0))
}

/// 読む手の数。ロットを読むのは、ほとんどがファイルを待つ時間（共有フォルダでは特に）なので、芯の数より多く並べる。
fn workers(n: usize) -> usize {
    let cpu = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    n.min((cpu * 2).clamp(8, 32))
}

/// ロットごとの値（{path: [列の順の値]}。読めないロットは {error}）。cols は value_of の列（{file, key, scale?, fmt?}）。
/// 1 度読んだ値は覚え（lotstore）から返し、覚えに無い列があるロットだけを読む。refresh なら、覚えを捨てて読み直す。
/// cached_only なら、ロットを読まずに覚えている値だけを返す（無い所は null。画面が、読む前に覚えている分を一度に並べるため）。
pub fn values(app: &App, paths: &[String], cols: &[Value], refresh: bool, cached_only: bool) -> Value {
    if refresh {
        app.lotstore.forget(paths);
        app.lots.forget(paths);
    }
    let keys: Vec<String> = cols.iter().map(lotstore::col_key).collect();
    let next = AtomicUsize::new(0);
    let out: Mutex<Map<String, Value>> = Mutex::default();
    // 覚えだけを返すときは、ファイルの印（大きさ・時刻）を見るだけなので、並べる数を絞る
    let n = if cached_only { paths.len().min(8) } else { workers(paths.len()) };
    std::thread::scope(|s| {
        for _ in 0..n {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                let Some(p) = paths.get(i) else { break };
                let sig = lotstore::lot_sig(Path::new(p));
                let mut got = app.lotstore.get(p, &sig, &keys);
                let v = if got.iter().all(Option::is_some) {
                    json!(got.into_iter().flatten().collect::<Vec<_>>())
                } else if cached_only {
                    json!(got)
                } else {
                    match app.lots.get(p, &app.cfg, app.program.as_ref()) {
                        Ok(res) => {
                            let mut cache = BTreeMap::new();
                            let mut new = vec![];
                            for (j, c) in cols.iter().enumerate() {
                                if got[j].is_none() {
                                    let v = value_of(&res, c, &mut cache);
                                    new.push((keys[j].clone(), v.clone()));
                                    got[j] = Some(v);
                                }
                            }
                            app.lotstore.put(p, &sig, new);
                            json!(got.into_iter().flatten().collect::<Vec<_>>())
                        }
                        Err(e) => json!({"error": e}),
                    }
                };
                out.lock().unwrap().insert(p.clone(), v);
            });
        }
    });
    Value::Object(out.into_inner().unwrap())
}
