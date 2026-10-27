//! ロット表の値を作るのに、1 ロットで何に時間がかかるかを測る（画面に出ない改良の根拠）。
//!
//!     cargo run --release --example listbench -- <設備のフォルダ> [--n 200]
//!
//! 設備の下のロットを n 個、1 本で順に（並べずに）読み、ロット表の初めの列（フォルダ名・表示項目・確かめ）を作る手順ごとに、
//! 1 ロットあたりの時間を出す。どの手順もロットを読み始めてから（覚えを使わずに）測る。
//!   walk   ロットを開く（フォルダをたどってファイルの一覧を作る）
//!   defs   .dat の定義（option/InspectDataInfo.xml）を読む
//!   insp   INSP_INFO.dat を読む
//!   cond   条件の XML（cond/COND*.xml）を (鍵, 値) に平らにする
//!   kinds  分類の名前（条件の XML の classification_conditions）
//!   values 表示項目・確かめの値を全部作る（上の物を使う。残りの時間）
use dt_core::config::Config;
use dt_core::lot::{self, LotRes};
use dt_core::lotlist;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let root = PathBuf::from(args.first().expect("使い方: listbench <設備のフォルダ> [--n 200]"));
    let n: usize = args.iter().position(|a| a == "--n").and_then(|i| args.get(i + 1)).and_then(|s| s.parse().ok()).unwrap_or(200);
    let re = regex::Regex::new(r"^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$").unwrap();
    let lots: Vec<PathBuf> = lotlist::lots_under(&root, &re, 6).into_iter().take(n).collect();
    let home = std::env::temp_dir().join(format!("dt-listbench-{}", std::process::id()));
    let cfg = Arc::new(Config::from_value(json!({}), &home));
    let pins = dt_core::pins::defaults();
    let mut cols: Vec<serde_json::Value> = ["lot", "date", "time"].iter().map(|k| json!({"file": "@lot", "key": k})).collect();
    cols.extend(pins.iter().filter(|p| p["scope"] == "lot" && (p["place"] == "list" || p["place"] == "summary")).cloned());
    cols.extend(["overload", "detect_max", "time_warn"].iter().map(|k| json!({"file": "@check", "key": k})));
    let mut t = [0f64; 6];
    let lap = |t0: &mut Instant| {
        let e = t0.elapsed().as_secs_f64() * 1000.0;
        *t0 = Instant::now();
        e
    };
    for l in &lots {
        let mut t0 = Instant::now();
        let res = LotRes::new(l, cfg.clone(), None);
        t[0] += lap(&mut t0);
        let _ = res.defs();
        t[1] += lap(&mut t0);
        let _ = res.dat("INSP_INFO");
        t[2] += lap(&mut t0);
        for p in res.glob("cond/COND*.xml") {
            let _ = dt_core::xml::pairs(&p);
        }
        t[3] += lap(&mut t0);
        let _ = res.kinds();
        t[4] += lap(&mut t0);
        let mut cache = std::collections::BTreeMap::new();
        for c in &cols {
            let _ = lotlist::value_of(&res, c, &mut cache);
        }
        t[5] += lap(&mut t0);
    }
    // 条件の XML: 字にする・XML として読む・(鍵, 値) に平らにする の内訳（先頭のロットの物で 50 回）
    if let Some(p) = lots.first().and_then(|l| LotRes::new(l, cfg.clone(), None).glob("cond/COND*.xml").into_iter().next()) {
        let b = std::fs::read(&p).unwrap_or_default();
        let (mut td, mut tp, mut tw) = (0f64, 0f64, 0f64);
        for _ in 0..50 {
            let mut t0 = Instant::now();
            let text = dt_core::xml::decode(&b);
            td += lap(&mut t0);
            let doc = roxmltree::Document::parse(&text).unwrap();
            tp += lap(&mut t0);
            drop(doc);
            let _ = dt_core::xml::parse_pairs(&b, 6000);
            tw += lap(&mut t0);
        }
        println!("条件の XML（{} KB）: 字にする {:.3} ms・XML として読む {:.3} ms・全部（読む＋平らにする）{:.3} ms", b.len() / 1024, td / 50.0, tp / 50.0, tw / 50.0);
    }
    let k = lots.len().max(1) as f64;
    let total: f64 = t.iter().sum();
    println!("{} ロット・{} 列（1 本で順に）: 1 ロット {:.2} ms", lots.len(), cols.len(), total / k);
    for (name, v) in ["walk", "defs", "insp", "cond", "kinds", "values"].iter().zip(t) {
        println!("  {name:7} {:6.3} ms（{:4.1}%）", v / k, 100.0 * v / total.max(1e-9));
    }
    let _ = lot::name_of(&root);
    let _ = std::fs::remove_dir_all(&home);
}
