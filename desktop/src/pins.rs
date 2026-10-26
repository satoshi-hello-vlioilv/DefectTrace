//! 表示項目（ピン）: どのデータの項目を、画面のどこ（ロット一覧・サマリ・ロット情報・画像表示・画像情報・MAP の軸）に出すか。
//! 置き場は作業場所の pins.json（版を入れ替えても残る）。新しい版で既定の項目が増えたら、1 度だけ足す（pins_meta.json の seen_defaults）。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const C: &str = "condition/target_conditions/target/roll_info/comments/comment[{}]@value";
const D: &str = "dat:DETECT_INFO";
const I: &str = "dat:INSP_INFO";

/// 表示先 → 置ける項目の種類（lot・image・any）。
pub fn place_need(place: &str) -> Option<&'static str> {
    Some(match place {
        "list" | "summary" | "lot" => "lot",
        "image" => "any",
        "card" | "mapx" | "mapy" => "image",
        _ => return None,
    })
}

/// 1 つしか置けない表示先。
pub fn single(place: &str) -> bool {
    matches!(place, "mapx" | "mapy")
}

pub fn compatible(scope: &str, place: &str) -> bool {
    matches!(place_need(place), Some("any")) || place_need(place) == Some(scope)
}

pub const FMTS: [&str; 4] = ["hhmm", "hhmmss", "mmdd", "yyyymmdd"];

#[allow(clippy::too_many_arguments)] // 既定の表の 1 行（並べて読みやすいよう、名前つきの形にしない）
fn p(id: &str, scope: &str, place: &str, label: &str, file: &str, key: &str, scale: Option<f64>, fmt: Option<&str>) -> Value {
    let mut v = json!({"id": id, "scope": scope, "place": place, "label": label, "file": file, "key": key});
    if let Some(s) = scale {
        v["scale"] = json!(s);
    }
    if let Some(f) = fmt {
        v["fmt"] = json!(f);
    }
    v
}

fn c(i: usize) -> String {
    C.replace("{}", &i.to_string())
}

/// 既定の表示項目（版 3.8 と同じ）。
pub fn defaults() -> Vec<Value> {
    vec![
        p("d_list_lot", "lot", "list", "ロットNo", "cond/COND*.xml", &c(0), None, None),
        p("d_list_time", "lot", "list", "時刻", "@lot", "time", None, Some("hhmm")),
        p("d_s_lot", "lot", "summary", "ロットNo", "cond/COND*.xml", &c(0), None, None),
        p("d_s_mat", "lot", "summary", "材質", "cond/COND*.xml", &c(4), None, None),
        p("d_s_tmp", "lot", "summary", "調質", "cond/COND*.xml", &c(5), None, None),
        p("d_s_t", "lot", "summary", "板厚", "cond/COND*.xml", &c(6), None, None),
        p("d_s_w", "lot", "summary", "板幅", "cond/COND*.xml", &c(7), None, None),
        p("d_s_use", "lot", "summary", "用途名", "cond/COND*.xml", &c(11), None, None),
        p("d_s_len", "lot", "summary", "検査長(m)", I, "insp_end_y", Some(0.001), None),
        p("d_s_dc", "lot", "summary", "欠陥数", I, "detect_total_cnt", None, None),
        p("d_s_wid", "lot", "summary", "検査幅(mm)", I, "@insp_width", None, None),
        p("d_l_ord", "lot", "lot", "検査順", "cond/COND*.xml", &c(1), None, None),
        p("d_l_cno", "lot", "lot", "条件No", "cond/COND*.xml", &c(2), None, None),
        p("d_l_use", "lot", "lot", "用途", "cond/COND*.xml", &c(3), None, None),
        p("d_l_ino", "lot", "lot", "検査番号", "cond/COND*.xml", &c(8), None, None),
        p("d_l_out", "lot", "lot", "出巻", "cond/COND*.xml", &c(9), None, None),
        p("d_l_crs", "lot", "lot", "コース", "cond/COND*.xml", &c(10), None, None),
        p("d_l_cnd", "lot", "lot", "検査条件", "cond/COND*.xml", "condition/header/cond_name@value", None, None),
        p("d_l_st", "lot", "lot", "検査開始日時", I, "start_time", None, None),
        p("d_l_ed", "lot", "lot", "検査終了日時", I, "end_time", None, None),
        p("d_l_ic", "lot", "lot", "画像数", I, "image_total_cnt", None, None),
        p("d_c_x", "image", "card", "幅方向OS～(mm)", D, "@os_x", None, None),
        p("d_c_y", "image", "card", "長さ方向(m)", D, "y_mm", Some(0.001), None),
        p("d_c_a", "image", "card", "面積(mm²)", D, "area_mm", None, None),
        p("d_i_w", "image", "image", "幅(mm)", D, "width_mm", None, None),
        p("d_i_l", "image", "image", "長さ(mm)", D, "length_mm", None, None),
        p("d_i_p1", "image", "image", "ピークレベル明", D, "peek_level1", None, None),
        p("d_i_p2", "image", "image", "ピークレベル暗", D, "peek_level2", None, None),
        p("d_i_a2", "image", "image", "平均レベル暗", D, "ave_level2", None, None),
        p("d_i_cam", "image", "image", "カメラ", D, "camera", None, None),
        p("d_i_sp", "image", "image", "ライン速度", D, "line_speed", None, None),
        p("d_i_dt", "image", "image", "発生日時", D, "datetime", None, None),
        p("d_mx", "image", "mapx", "幅方向OS～(mm)", D, "@os_x", None, None),
        p("d_my", "image", "mapy", "長さ方向(m)", D, "y_mm", Some(0.001), None),
    ]
}

/// 版 3.3 にあった既定（pins_meta.json が無い古い pins.json に、新しい既定だけを足すため）。
const V33: [&str; 31] = [
    "d_list_lot",
    "d_s_lot",
    "d_s_mat",
    "d_s_tmp",
    "d_s_t",
    "d_s_w",
    "d_s_use",
    "d_s_len",
    "d_s_dc",
    "d_l_ord",
    "d_l_cno",
    "d_l_use",
    "d_l_ino",
    "d_l_out",
    "d_l_crs",
    "d_l_cnd",
    "d_l_st",
    "d_l_ed",
    "d_l_ic",
    "d_c_x",
    "d_c_y",
    "d_c_a",
    "d_i_w",
    "d_i_l",
    "d_i_p1",
    "d_i_p2",
    "d_i_a2",
    "d_i_cam",
    "d_i_dt",
    "d_mx",
    "d_my",
];

pub struct Pins {
    pub list: Mutex<Vec<Value>>,
    path: PathBuf,
    meta: PathBuf,
}

fn id(v: &Value) -> &str {
    v["id"].as_str().unwrap_or("")
}

impl Pins {
    /// 読む（無ければ既定）。新しい版の既定を 1 度だけ足し、書き戻す。
    pub fn load(dir: &Path) -> Pins {
        let (path, meta) = (dir.join("pins.json"), dir.join("pins_meta.json"));
        let defs = defaults();
        let read = |p: &Path| {
            std::fs::read(p).ok().and_then(|b| serde_json::from_slice::<Value>(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b)).ok())
        };
        let mut pins: Vec<Value> = match read(&path) {
            None if !path.exists() => defs.clone(),
            None => {
                eprintln!("[WARN] pins.json を読めません");
                return Pins { list: Mutex::new(defs), path, meta };
            }
            Some(v) => {
                let mut pins: Vec<Value> = v.as_array().cloned().unwrap_or_default();
                let seen: Vec<String> = read(&meta)
                    .and_then(|m| m["seen_defaults"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()))
                    .unwrap_or_else(|| V33.iter().map(|s| s.to_string()).collect());
                for (i, d) in defs.iter().enumerate() {
                    if seen.iter().any(|s| s == id(d)) || pins.iter().any(|x| id(x) == id(d)) {
                        continue;
                    }
                    // 同じ表示先の 1 つ前の既定の後ろへ
                    let mut pos = pins.len();
                    for q in defs[..i].iter().rev() {
                        if let Some(j) = pins.iter().position(|x| id(x) == id(q)) {
                            if q["place"] == d["place"] {
                                pos = j + 1;
                                break;
                            }
                        }
                    }
                    pins.insert(pos, d.clone());
                }
                // 既定の項目の単位の倍率が消えていれば戻す
                for x in pins.iter_mut() {
                    if let Some(d) = defs.iter().find(|d| id(d) == id(x)) {
                        if d.get("scale").is_some() && x.get("scale").is_none() && x["key"] == d["key"] {
                            x["scale"] = d["scale"].clone();
                        }
                    }
                }
                pins
            }
        };
        pins.retain(Value::is_object);
        let me = Pins { list: Mutex::new(pins), path, meta };
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(&me.meta, serde_json::to_vec(&json!({"seen_defaults": defs.iter().map(id).collect::<Vec<_>>()})).unwrap());
        me.save(&me.list.lock().unwrap());
        me
    }

    pub fn save(&self, pins: &[Value]) {
        if let Err(e) = std::fs::write(&self.path, serde_json::to_vec_pretty(pins).unwrap_or_default()) {
            eprintln!("[WARN] pins save: {e}");
        }
    }

    pub fn snapshot(&self) -> Vec<Value> {
        self.list.lock().unwrap().clone()
    }

    /// 足す（POST /api/pins）。
    pub fn add(&self, b: &Value, new_id: String) -> Result<Vec<Value>, String> {
        let (scope, place) = (b["scope"].as_str().unwrap_or(""), b["place"].as_str().unwrap_or(""));
        if !compatible(scope, place) {
            return Err("この表示先には設定できない項目です".into());
        }
        let file = b["file"].as_str().unwrap_or("@image");
        let key = b["key"].as_str().unwrap_or("");
        let fmt = (file == "@lot")
            .then(|| {
                if key == "time" {
                    Some("hhmm")
                } else if key == "date" {
                    Some("mmdd")
                } else {
                    None
                }
            })
            .flatten();
        let item = p(&new_id, scope, place, b["label"].as_str().unwrap_or(""), file, key, None, fmt);
        let mut l = self.list.lock().unwrap();
        if single(place) {
            l.retain(|x| x["place"] != place);
        }
        let before = b["before"].as_str().filter(|s| !s.is_empty());
        let idx = before.and_then(|bf| l.iter().position(|x| id(x) == bf)).unwrap_or(l.len());
        l.insert(idx, item);
        self.save(&l);
        Ok(l.clone())
    }

    /// 直す（PATCH /api/pins/<id>）: 名前・書式・表示先・並び。
    pub fn patch(&self, pid: &str, b: &Value) -> Result<Vec<Value>, (u16, String)> {
        let mut l = self.list.lock().unwrap();
        let Some(i) = l.iter().position(|x| id(x) == pid) else { return Err((404, "not found".into())) };
        if let Some(lab) = b.get("label") {
            l[i]["label"] = lab.clone();
        }
        if let Some(f) = b["fmt"].as_str().filter(|f| FMTS.contains(f)) {
            l[i]["fmt"] = json!(f);
        }
        if let Some(place) = b.get("place") {
            let pl = place.as_str().unwrap_or("");
            if !compatible(l[i]["scope"].as_str().unwrap_or(""), pl) {
                return Err((400, "この表示先には設定できない項目です".into()));
            }
            if single(pl) {
                l.retain(|x| x["place"] != pl || id(x) == pid);
            }
            let i = l.iter().position(|x| id(x) == pid).unwrap();
            l[i]["place"] = place.clone();
        }
        if let Some(before) = b.get("before") {
            let bf = before.as_str().unwrap_or("");
            if bf != pid {
                let i = l.iter().position(|x| id(x) == pid).unwrap();
                let item = l.remove(i);
                let idx = if bf.is_empty() { l.len() } else { l.iter().position(|x| id(x) == bf).unwrap_or(l.len()) };
                l.insert(idx, item);
            }
        }
        self.save(&l);
        Ok(l.clone())
    }

    pub fn delete(&self, pid: &str) -> Vec<Value> {
        let mut l = self.list.lock().unwrap();
        l.retain(|x| id(x) != pid);
        self.save(&l);
        l.clone()
    }

    pub fn reset(&self) -> Vec<Value> {
        let mut l = self.list.lock().unwrap();
        *l = defaults();
        self.save(&l);
        l.clone()
    }
}
