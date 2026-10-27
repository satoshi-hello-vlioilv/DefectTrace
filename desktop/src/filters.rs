//! 欠陥のフィルタ（ロットの画像一覧を、DETECT_INFO の項目〈長さ・幅・面積・縦横比・分類・面 など〉で絞る）。
//!
//! フィルタ 1 つ = 名前と条件の並び（{field, op, v, v2}）と、条件のつなぎ方（all: すべて満たす／どれか）。
//! 使うときは、選んだフィルタを全部重ねる（どれも満たす欠陥の画像だけを出す）。
//! 置き場は 3 つ（scope）:
//! - 既定（def）: 共有の置き場 <更新の置き場のアプリのフォルダ>\shared\filters-default.json。書けるのは開発者（Config::who）だけ
//! - 共有（share）: 同じ所の filters-shared.json。だれでも書ける
//! - 自分（mine）: この PC の作業場所の filters.json
//!
//! 書くときは、書く直前に読み直して 1 つだけ入れ替え（ほかの人が同じ時に保存した物を消さない）、一時ファイルに書いてから置き換える。

use crate::dat::{Dat, Rec};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

pub const SCOPES: [&str; 3] = ["def", "share", "mine"];
const OPS: [&str; 8] = [">=", "<=", ">", "<", "=", "!=", "between", "in"];

/// 置き場ごとのファイル。
pub struct Store {
    /// 作業場所（自分の条件）
    pub home: PathBuf,
    /// 共有の置き場（届かなければ None。既定・共有は読めず、書けない）
    pub shared: Option<PathBuf>,
}

impl Store {
    fn file(&self, scope: &str) -> Result<PathBuf, String> {
        match scope {
            "mine" => Ok(self.home.join("filters.json")),
            "def" | "share" => self
                .shared
                .as_ref()
                .map(|d| d.join(if scope == "def" { "filters-default.json" } else { "filters-shared.json" }))
                .ok_or_else(|| "共有の置き場に届きません（既定・共有のフィルタは、更新の置き場〈BOX〉に置きます）".into()),
            _ => Err(format!("置き場 {scope} は知りません（def・share・mine）")),
        }
    }

    fn read(&self, scope: &str) -> Result<Vec<Value>, String> {
        let f = self.file(scope)?;
        match std::fs::read(&f) {
            Ok(b) => serde_json::from_slice::<Value>(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b))
                .map(|v| v["filters"].as_array().cloned().unwrap_or_default())
                .map_err(|e| format!("{}: 形が違います（{e}）", f.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
            Err(e) => Err(format!("{}: 読めません（{e}）", f.display())),
        }
    }

    fn write(&self, scope: &str, list: &[Value]) -> Result<(), String> {
        let f = self.file(scope)?;
        let dir = f.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
        let tmp = f.with_extension(format!("json.{}.tmp", std::process::id()));
        let body = serde_json::to_vec_pretty(&json!({"schema": 1, "filters": list})).unwrap_or_default();
        std::fs::write(&tmp, body).map_err(|e| format!("{} に書けません: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &f).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("{} を置き換えられません: {e}", f.display())
        })
    }

    /// 全部の置き場のフィルタ（scope を付ける）と、読めなかった理由。
    pub fn list(&self) -> Value {
        let (mut all, mut problems) = (vec![], vec![]);
        for sc in SCOPES {
            match self.read(sc) {
                Ok(v) => all.extend(v.into_iter().map(|mut f| {
                    f["scope"] = json!(sc);
                    f
                })),
                Err(e) if sc != "mine" && self.shared.is_none() => {
                    if !problems.contains(&e) {
                        problems.push(e)
                    }
                }
                Err(e) => problems.push(e),
            }
        }
        json!({"filters": all, "problems": problems, "shared": self.shared})
    }

    /// 保存する（id が同じ物を置き換える。無ければ足す）。既定は開発者だけ。→ 保存したフィルタ
    pub fn save(&self, scope: &str, f: &Value, by: &str, developer: bool) -> Result<Value, String> {
        if scope == "def" && !developer {
            return Err("既定のフィルタを決められるのは開発者だけです（共有か自分に保存してください）".into());
        }
        let mut f = check(f)?;
        let id = match f["id"].as_str() {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => format!("f{}", chrono::Local::now().format("%Y%m%d%H%M%S%3f")),
        };
        f["id"] = json!(id);
        f["by"] = json!(by);
        f["at"] = json!(chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string());
        let mut list = self.read(scope)?;
        list.retain(|x| x["id"].as_str() != Some(id.as_str()));
        list.push(f.clone());
        self.write(scope, &list)?;
        f["scope"] = json!(scope);
        Ok(f)
    }

    /// 消す。既定は開発者だけ。
    pub fn delete(&self, scope: &str, id: &str, developer: bool) -> Result<Value, String> {
        if scope == "def" && !developer {
            return Err("既定のフィルタを消せるのは開発者だけです".into());
        }
        let mut list = self.read(scope)?;
        let n = list.len();
        list.retain(|x| x["id"].as_str() != Some(id));
        if list.len() == n {
            return Err("そのフィルタはありません（もう消したかもしれません）".into());
        }
        self.write(scope, &list)?;
        Ok(json!({"deleted": id}))
    }
}

/// 形を確かめて、要る所だけにする（名前・つなぎ方・条件）。
pub fn check(f: &Value) -> Result<Value, String> {
    let name = f["name"].as_str().unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Err("フィルタの名前を入れてください".into());
    }
    let conds = f["conds"].as_array().cloned().unwrap_or_default();
    if conds.is_empty() {
        return Err("条件を 1 つ以上入れてください".into());
    }
    let mut out = vec![];
    for c in conds {
        let field = c["field"].as_str().unwrap_or("").trim();
        let op = c["op"].as_str().unwrap_or("");
        if field.is_empty() || !OPS.contains(&op) {
            return Err(format!("条件の項目か比べ方が正しくありません（{c}）"));
        }
        let num = |k: &str| c[k].as_f64().or_else(|| c[k].as_str().and_then(|s| s.trim().parse().ok()));
        let mut o = Map::new();
        o.insert("field".into(), json!(field));
        o.insert("op".into(), json!(op));
        match op {
            "in" => {
                let vs: Vec<f64> = c["v"].as_array().map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
                if vs.is_empty() {
                    return Err(format!("「{field}」の選ぶ値がありません"));
                }
                o.insert("v".into(), json!(vs));
            }
            "between" => {
                let (Some(a), Some(b)) = (num("v"), num("v2")) else {
                    return Err(format!("「{field}」の範囲の数を入れてください"));
                };
                o.insert("v".into(), json!(a.min(b)));
                o.insert("v2".into(), json!(a.max(b)));
            }
            _ => {
                let Some(a) = num("v") else { return Err(format!("「{field}」の数を入れてください")) };
                o.insert("v".into(), json!(a));
            }
        }
        out.push(Value::Object(o));
    }
    Ok(json!({"id": f["id"], "name": name, "all": f["all"] != false, "conds": out, "note": f["note"].as_str().unwrap_or("")}))
}

/// 欠陥 1 つが条件 1 つを満たすか（値の無い・数でない欠陥は満たさない）。
fn meets(det: &Dat, r: &Rec, c: &Value) -> bool {
    let Some(x) = det.get(r, c["field"].as_str().unwrap_or("")).and_then(|v| v.num()) else { return false };
    let v = c["v"].as_f64().unwrap_or(f64::NAN);
    match c["op"].as_str().unwrap_or("") {
        ">=" => x >= v,
        "<=" => x <= v,
        ">" => x > v,
        "<" => x < v,
        "=" => (x - v).abs() < 1e-9,
        "!=" => (x - v).abs() >= 1e-9,
        "between" => x >= v && x <= c["v2"].as_f64().unwrap_or(f64::NAN),
        "in" => c["v"].as_array().is_some_and(|a| a.iter().filter_map(Value::as_f64).any(|y| (x - y).abs() < 1e-9)),
        _ => false,
    }
}

/// 欠陥 1 つがフィルタ 1 つを満たすか。
pub fn passes(det: &Dat, r: &Rec, f: &Value) -> bool {
    let conds = f["conds"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    if f["all"] == false {
        conds.iter().any(|c| meets(det, r, c))
    } else {
        conds.iter().all(|c| meets(det, r, c))
    }
}

/// 重ねたフィルタを全部満たす欠陥の番号（DETECT_INFO の並びの位置）。
pub fn select(det: &Dat, filters: &[Value]) -> Vec<usize> {
    det.records.iter().enumerate().filter(|(_, r)| filters.iter().all(|f| passes(det, r, f))).map(|(i, _)| i).collect()
}

/// 項目 1 つの分布（このロット。最小・最大と、間を bins 個に分けた数）。値の無い欠陥は数えない。
pub fn hist(det: &Dat, field: &str, bins: usize) -> Value {
    let xs: Vec<f64> = det.records.iter().filter_map(|r| det.get(r, field).and_then(|v| v.num())).filter(|x| x.is_finite()).collect();
    let (lo, hi) = xs.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &x| (a.min(x), b.max(x)));
    if xs.is_empty() {
        return json!({"n": 0, "min": null, "max": null, "bins": []});
    }
    let w = if hi > lo { (hi - lo) / bins as f64 } else { 1.0 };
    let mut c = vec![0usize; bins.max(1)];
    for x in &xs {
        c[(((x - lo) / w) as usize).min(bins.max(1) - 1)] += 1;
    }
    json!({"n": xs.len(), "min": lo, "max": hi, "bins": c})
}

/// 条件に使える項目（数の項目。名前と表示名）。
pub fn fields(det: &Dat) -> Vec<Value> {
    det.fields
        .iter()
        .filter(|f| {
            let t = f.typ.to_ascii_lowercase();
            f.cnt <= 1 && ["int", "single", "double", "float", "decimal", "byte", "short", "long"].iter().any(|k| t.contains(k))
        })
        .map(|f| json!({"name": f.name, "label": if f.label.is_empty() { f.name.clone() } else { f.label.clone() }}))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_keeps_only_what_a_filter_needs() {
        assert!(check(&json!({"name": "", "conds": [{"field": "a", "op": ">=", "v": 1}]})).unwrap_err().contains("名前"));
        assert!(check(&json!({"name": "x", "conds": []})).unwrap_err().contains("条件"));
        assert!(check(&json!({"name": "x", "conds": [{"field": "a", "op": "~", "v": 1}]})).is_err(), "知らない比べ方");
        assert!(check(&json!({"name": "x", "conds": [{"field": "a", "op": ">=", "v": "abc"}]})).unwrap_err().contains("数"));
        let f =
            check(&json!({"name": " 長い ", "junk": 1, "conds": [{"field": "length_mm", "op": "between", "v": "20", "v2": 5}]})).unwrap();
        assert_eq!(f["name"], "長い");
        assert_eq!(f["conds"][0], json!({"field": "length_mm", "op": "between", "v": 5.0, "v2": 20.0}), "字の数も読み、範囲は小さい順に");
        assert_eq!(f["all"], true, "つなぎ方の既定は「すべて満たす」");
        assert!(f.get("junk").is_none());
    }

    #[test]
    fn three_places_and_only_developers_write_the_defaults() {
        let d = std::env::temp_dir().join(format!("dt-filters-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let s = Store { home: d.join("home"), shared: Some(d.join("box").join("shared")) };
        let f = json!({"name": "大きい欠陥", "conds": [{"field": "length_mm", "op": ">=", "v": 10}]});
        assert!(s.save("def", &f, "u1", false).unwrap_err().contains("開発者"), "開発者でなければ既定は書けない");
        let a = s.save("def", &f, "dev", true).unwrap();
        s.save("share", &json!({"name": "面積", "conds": [{"field": "area_mm", "op": ">=", "v": 5}]}), "u1", false).unwrap();
        s.save("mine", &json!({"name": "細い", "conds": [{"field": "vh_rate", "op": ">=", "v": 3}]}), "u1", false).unwrap();
        let l = s.list();
        let names: Vec<(String, String)> = l["filters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| (x["scope"].as_str().unwrap().into(), x["name"].as_str().unwrap().into()))
            .collect();
        assert_eq!(names, [("def".into(), "大きい欠陥".into()), ("share".into(), "面積".into()), ("mine".into(), "細い".into())]);
        // 同じ id で保存すると置き換える（増えない）
        let mut b = a.clone();
        b["name"] = json!("大きい欠陥 2");
        s.save("def", &b, "dev", true).unwrap();
        assert_eq!(s.read("def").unwrap().len(), 1);
        assert_eq!(s.read("def").unwrap()[0]["name"], "大きい欠陥 2");
        assert!(s.delete("def", a["id"].as_str().unwrap(), false).is_err(), "開発者でなければ既定は消せない");
        s.delete("def", a["id"].as_str().unwrap(), true).unwrap();
        assert!(s.read("def").unwrap().is_empty());
        // 共有の置き場に届かない PC: 自分のは使え、既定・共有は理由を 1 つだけ添える
        let off = Store { home: d.join("home"), shared: None };
        let l = off.list();
        assert_eq!((l["filters"].as_array().unwrap().len(), l["problems"].as_array().unwrap().len()), (1, 1), "{l}");
        assert!(off.save("share", &f, "u1", false).unwrap_err().contains("届きません"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
