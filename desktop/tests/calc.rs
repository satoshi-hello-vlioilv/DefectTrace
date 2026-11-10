//! 計算で作る項目（元のアプリの欠陥詳細と同じ名前・同じ値）の試験。
//! 値は、元のアプリの欠陥詳細の画面（LS3・2026/10/22 のロットの欠陥No:7）と、その実データの記録から取った:
//!   x_mm 417.926836・base_x 391.340442・insp_area_st 388.227318・insp_area_ed 1514.855827・8 番目のコメント 1070.0・
//!   rankID 638048882244344834（許容）・lsc 0
//!   → OS元幅 26.59・DS元幅 1100.04・OS幅入後 −1.73・DS幅入後 1071.73・ランク 許容・検出LSC 1

use dt_core::config::Config;
use dt_core::lot::{self, fmt_num, LotRes};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 1 欄（名前・型）
type F = (&'static str, &'static str);
const DETECT: [F; 6] = [
    ("type", "System.Int32"),
    ("detectNo", "System.Int32"),
    ("rankID", "System.Int64"),
    ("lsc", "System.Int32"),
    ("base_x", "System.Double"),
    ("x_mm", "System.Double"),
];
const INSP: [F; 2] = [("insp_area_st", "System.Double"), ("insp_area_ed", "System.Double")];

enum Val {
    I(i64),
    F(f64),
}

fn defs() -> String {
    let st = |id: u32, name: &str, fs: &[F]| {
        let rows: String = fs.iter().map(|(n, t)| format!(r#"<field name="{n}" type="{t}"/>"#)).collect();
        format!(r#"<structure id="{id}" name="{name}">{rows}</structure>"#)
    };
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?><InspectDataInfo><definitions>{}{}</definitions><system_default><DETECT_INFO dataVersion="1"/><INSP_INFO dataVersion="2"/></system_default></InspectDataInfo>"#,
        st(1, "DETECT_INFO", &DETECT),
        st(2, "INSP_INFO", &INSP)
    )
}

/// .dat（頭: 頭の長さ・dataVersion・1 件のバイト数・名前、続いて [印 1 バイト + 1 件] の繰り返し）
fn dat(name: &str, ver: i32, fs: &[F], recs: &[Vec<Val>]) -> Vec<u8> {
    let rows: Vec<Vec<u8>> = recs
        .iter()
        .map(|r| {
            let mut b = vec![];
            for ((_, t), v) in fs.iter().zip(r) {
                match (*t, v) {
                    ("System.Int32", Val::I(i)) => b.extend((*i as i32).to_le_bytes()),
                    ("System.Int64", Val::I(i)) => b.extend(i.to_le_bytes()),
                    ("System.Double", Val::F(f)) => b.extend(f.to_le_bytes()),
                    _ => panic!("型が合わない: {t}"),
                }
            }
            b
        })
        .collect();
    let mut out = vec![];
    out.extend((13 + name.len() as i32).to_le_bytes());
    out.extend(ver.to_le_bytes());
    out.extend((rows[0].len() as i32).to_le_bytes());
    out.push(name.len() as u8);
    out.extend(name.as_bytes());
    for r in rows {
        out.push(1);
        out.extend(r);
    }
    out
}

fn cond(comments: &[&str]) -> String {
    let cs: String = comments.iter().map(|c| format!(r#"<comment value="{c}"/>"#)).collect();
    let rank = |n: &str, id: &str| {
        format!(r#"<rank_condition><rank_name value="{n}"/><rank_id value="{id}"/><disp_sw value="True"/></rank_condition>"#)
    };
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?><condition><header><cond_name value="厳しい"/></header><target_conditions><target><roll_info><comments>{cs}</comments></roll_info></target></target_conditions><rank_conditions>{}{}{}</rank_conditions></condition>"#,
        rank("一般", "635113139961906359"),
        rank("許容", "638048882244344834"),
        rank("未分類", "635113836103233106")
    )
}

/// 欠陥No:7 と同じ値のロット（ほかに、名前の無いランク〈-1〉と DS 側の欠陥を 1 件ずつ）
fn make_lot(root: &Path) -> PathBuf {
    let lot = root.join("2026_10_22_13_29_29");
    std::fs::create_dir_all(lot.join("cond")).unwrap();
    std::fs::write(lot.join("InspectDataInfo.xml"), defs()).unwrap();
    let recs = vec![
        vec![Val::I(1), Val::I(7), Val::I(638048882244344834), Val::I(0), Val::F(391.340442), Val::F(417.926836)],
        vec![Val::I(1), Val::I(8), Val::I(-1), Val::I(5), Val::F(391.0), Val::F(1500.0)],
    ];
    std::fs::write(lot.join("DETECT_INFO.dat"), dat("DETECT_INFO", 1, &DETECT, &recs)).unwrap();
    std::fs::write(lot.join("INSP_INFO.dat"), dat("INSP_INFO", 2, &INSP, &[vec![Val::F(388.227318), Val::F(1514.855827)]])).unwrap();
    let comments = ["L8371K0", "0001", "01", "E122", "PF45", "H14", "0.300", "1070.0", "N6X1048", "UU"];
    std::fs::write(lot.join("cond").join("COND0001.xml"), cond(&comments)).unwrap();
    lot
}

fn temp(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("dt-calc-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    root
}

/// 計算の項目の値（画像表示と同じ: 数は小数 2 桁）
fn values(res: &LotRes, rec: usize) -> Vec<String> {
    let d = res.dat("DETECT_INFO");
    let r = &d.records[rec];
    ["@os_x", "@os_orig", "@ds_orig", "@os_trim", "@ds_trim", "@rank", "@lsc_no"]
        .iter()
        .map(|k| lot::rec_get(res, &d, r, k).map(|v| fmt_num(&v, None)).unwrap_or_else(|| "（無し）".into()))
        .collect()
}

#[test]
fn computed_items_match_the_original_app() {
    let root = temp("orig");
    let lot = make_lot(&root);
    let res = LotRes::new(&lot, Arc::new(Config::from_value(json!({}), &root.join("_home"))), None);
    let c = res.lot_calc();
    assert!((c.width.unwrap() - 1126.628509).abs() < 1e-6, "検査幅 {c:?}");
    assert_eq!(c.product, Some(1070.0), "製品幅は 8 番目のコメント");
    // 欠陥No:7: 元のアプリの欠陥詳細と同じ値
    assert_eq!(values(&res, 0), ["26.59", "26.59", "1100.04", "-1.73", "1071.73", "許容", "1"]);
    // 名前の無いランク（-1）は番号のまま・LSC は 1 から数える・DS 側の欠陥（DS元幅 = 検査幅 − OS元幅）
    assert_eq!(values(&res, 1), ["1109.00", "1109.00", "17.63", "1080.69", "-10.69", "-1", "6"]);
    // 計算の項目は、DETECT_INFO の項目として作れる（データ項目の窓に出る）
    let keys: Vec<&str> = lot::virtuals_of(&res.dat("DETECT_INFO")).map(|v| v.key).collect();
    assert_eq!(keys, ["@os_x", "@os_orig", "@ds_orig", "@os_trim", "@ds_trim", "@rank", "@lsc_no"]);
    let _ = std::fs::remove_dir_all(&root);
}

/// 製品幅のコメントの位置は設定で変えられる。製品幅や検査幅が無いロットでは、幅入後は作らない（0 として出さない）
#[test]
fn product_width_comment_is_configurable_and_missing_values_stay_empty() {
    let root = temp("cfg");
    let lot = make_lot(&root);
    let res = LotRes::new(&lot, Arc::new(Config::from_value(json!({"product_width_comment": 7}), &root.join("_home"))), None);
    assert_eq!(res.lot_calc().product, Some(0.3), "7 番目のコメント（板厚）");
    std::fs::remove_file(lot.join("INSP_INFO.dat")).unwrap();
    let res = LotRes::new(&lot, Arc::new(Config::from_value(json!({}), &root.join("_home"))), None);
    let v = values(&res, 0);
    assert_eq!(&v[2..5], ["（無し）", "（無し）", "（無し）"], "検査幅が無ければ DS元幅・幅入後は作らない");
    assert_eq!(&v[..2], ["26.59", "26.59"], "OS元幅は記録だけで作れる");
    let _ = std::fs::remove_dir_all(&root);
}

/// 新しい版で足した既定の表示項目は、使っている PC に 1 度だけ足す。ただし同じ表示先に同じ項目を利用者がもう置いていれば足さない
/// （利用者が一覧に「検査長(m)」を足していた PC で、2 つ並ばないように。版 4.13.0）
#[test]
fn new_defaults_are_added_once_without_doubling_what_the_user_placed() {
    use dt_core::pins::{defaults, Pins};
    let dir = temp("pins");
    std::fs::create_dir_all(&dir).unwrap();
    let new = ["d_list_len", "d_c_dso", "d_c_ost", "d_c_dst", "d_c_ar", "d_c_a2", "d_c_rank"];
    let mut pins: Vec<serde_json::Value> = defaults().into_iter().filter(|p| !new.contains(&p["id"].as_str().unwrap())).collect();
    // 利用者が足していた物: 一覧の検査長(m)・画像表示の平均レベル暗
    pins.push(json!({"id": "u1", "scope": "lot", "place": "list", "label": "検査長(m)", "file": "dat:INSP_INFO", "key": "insp_end_y", "scale": 0.001}));
    pins.push(
        json!({"id": "u2", "scope": "image", "place": "card", "label": "平均レベル暗", "file": "dat:DETECT_INFO", "key": "ave_level2"}),
    );
    let seen: Vec<&str> = pins.iter().filter_map(|p| p["id"].as_str()).filter(|i| i.starts_with("d_")).collect();
    std::fs::write(dir.join("pins.json"), serde_json::to_vec(&pins).unwrap()).unwrap();
    std::fs::write(dir.join("pins_meta.json"), serde_json::to_vec(&json!({"seen_defaults": seen})).unwrap()).unwrap();
    let got = Pins::load(&dir, Vec::new).snapshot();
    let ids = |place: &str| -> Vec<String> {
        got.iter().filter(|p| p["place"] == place).map(|p| p["id"].as_str().unwrap().to_string()).collect()
    };
    assert_eq!(ids("list"), ["d_list_lot", "d_list_time", "d_list_mat", "d_list_dc", "u1"], "検査長(m) は利用者の物があるので足さない");
    assert_eq!(
        ids("card"),
        ["d_c_x", "d_c_dso", "d_c_ost", "d_c_dst", "d_c_y", "d_c_a", "d_c_ar", "d_c_rank", "u2"],
        "新しい項目は同じ表示先の 1 つ前の既定（足さなかった物は飛ばす）の後ろへ。平均レベル暗は利用者の物があるので足さない"
    );
    // もう一度読んでも増えない（1 度だけ）
    let again = Pins::load(&dir, Vec::new).snapshot();
    assert_eq!(again.len(), got.len());
    let _ = std::fs::remove_dir_all(&dir);
}

/// 表示項目の数値の書式: 画像ごとの値・単位の倍率を掛けた値・条件の xml の数（板幅など）のどれにも当たる。書式が無ければ今までどおり
#[test]
fn number_format_of_a_pin_applies_everywhere() {
    let root = temp("fmt");
    let lot = make_lot(&root);
    let res = LotRes::new(&lot, Arc::new(Config::from_value(json!({}), &root.join("_home"))), None);
    let d = res.dat("DETECT_INFO");
    let r = d.records.first();
    let card = |p: serde_json::Value| lot::rec_value(&p, &d, r, &res, true);
    let pin = |key: &str, extra: serde_json::Value| {
        let mut p = json!({"file": "dat:DETECT_INFO", "key": key});
        p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        p
    };
    assert_eq!(card(pin("@ds_trim", json!({}))), "1071.73", "書式なし: 今までどおり小数 2 桁");
    assert_eq!(card(pin("@ds_trim", json!({"fmt": "0.0"}))), "1071.7");
    assert_eq!(card(pin("@ds_trim", json!({"fmt": "#,##0.000"}))), "1,071.728");
    assert_eq!(card(pin("x_mm", json!({"scale": 0.001, "fmt": "0.000"}))), "0.418", "倍率を掛けてから書式（2 桁に丸めてからではない）");
    assert_eq!(card(pin("@rank", json!({"fmt": "0.00"}))), "許容", "数でない値はそのまま");
    let xml = |fmt: Option<&str>| {
        let mut p = json!({"file": "cond/COND*.xml", "key": "condition/target_conditions/target/roll_info/comments/comment[7]@value"});
        if let Some(f) = fmt {
            p["fmt"] = json!(f);
        }
        lot::resolve_lot_pin(&res, &p)
    };
    assert_eq!(xml(None), "1070.0");
    assert_eq!(xml(Some("#,##0")), "1,070");
    let _ = std::fs::remove_dir_all(&root);
}
