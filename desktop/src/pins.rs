//! 表示項目（ピン）: どのデータの項目を、画面のどこ（ロット一覧・サマリ・ロット情報・画像表示・画像情報・MAP の軸）に出すか。
//! 置き場は作業場所の pins.json（版を入れ替えても残る）。新しい版で既定の項目が増えたら、1 度だけ足す（pins_meta.json の seen_defaults）。
//!
//! 表示の初期値（新しい PC の始めと「表示設定を初期化」で使う物）は、開発者が共有の置き場に決めた物（pins-default.json）があればそれ、
//! 無ければアプリに入った物（defaults）。各 PC の pins.json がいつも先（初期値を変えても、各 PC の表示は変わらない）。
//! 共有の置き場に届かない PC のために、最後に読めた開発者の初期値をこの PC の作業場所にも写しておく。

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

/// 既定の表示項目（版 3.8 と同じ。版 4.8.0 で一覧に材質と欠陥数を足した: desktop/tests/golden.rs の V48_ADDED）。
pub fn defaults() -> Vec<Value> {
    vec![
        p("d_list_lot", "lot", "list", "ロットNo", "cond/COND*.xml", &c(0), None, None),
        p("d_list_time", "lot", "list", "時刻", "@lot", "time", None, Some("hhmm")),
        // 版 4.8.0: 一覧にも材質と欠陥数（サマリと同じ項目・同じ名前）
        p("d_list_mat", "lot", "list", "材質", "cond/COND*.xml", &c(4), None, None),
        p("d_list_dc", "lot", "list", "欠陥数", I, "detect_total_cnt", None, None),
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

/// 繰り返しの番号を [*] にそろえたキー（comment[3] と comment[*] は同じ項目の決まりを使う）。
fn wild(k: &str) -> String {
    let mut out = String::with_capacity(k.len());
    let mut it = k.chars().peekable();
    while let Some(c) = it.next() {
        out.push(c);
        if c == '[' && it.peek().is_some_and(|d| d.is_ascii_digit() || *d == '*') {
            while it.peek().is_some_and(|d| d.is_ascii_digit() || *d == '*') {
                it.next();
            }
            out.push('*');
        }
    }
    out
}

/// 同じデータ項目か（同じファイル・同じキー。繰り返しの番号は問わない）。
fn same_item(a: &Value, b: &Value) -> bool {
    a["file"] == b["file"] && wild(a["key"].as_str().unwrap_or("")) == wild(b["key"].as_str().unwrap_or(""))
}

impl Pins {
    /// 読む（無ければ first: 表示の初期値。新しい PC だけ呼ぶ）。新しい版の既定を 1 度だけ足し、書き戻す。
    pub fn load(dir: &Path, first: impl FnOnce() -> Vec<Value>) -> Pins {
        let (path, meta) = (dir.join("pins.json"), dir.join("pins_meta.json"));
        let defs = defaults();
        let read = |p: &Path| {
            std::fs::read(p).ok().and_then(|b| serde_json::from_slice::<Value>(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b)).ok())
        };
        let mut pins: Vec<Value> = match read(&path) {
            None if !path.exists() => first(),
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
                // 既定の項目の単位の倍率が消えていれば戻す。同じ項目（file・key）を倍率なしで足した物（版 4.6.0 まで、データ項目の窓から
                // 置くと元の名前・倍率なしになっていた）も、既定の名前と倍率にそろえる（値の単位が変わるので、名前も単位の付いた既定の物に）
                for x in pins.iter_mut() {
                    if let Some(d) = defs.iter().find(|d| id(d) == id(x) || same_item(d, x)) {
                        if d.get("scale").is_some() && x.get("scale").is_none() && x["key"] == d["key"] {
                            x["scale"] = d["scale"].clone();
                            if id(d) != id(x) {
                                x["label"] = d["label"].clone();
                            }
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

    /// 足す（POST /api/pins）。同じ項目（file・key）の決まり（名前・単位の倍率・書式）を、いまの表示項目 → initial（表示の初期値）→
    /// アプリの初期値 の順に探して引き継ぐ（どこに置いても同じ名前・同じ単位で出す）。名前は、利用者が付けた物（named）なら
    /// それ、決まりが無ければ送られた名前（データの元の名前）。
    pub fn add(&self, b: &Value, new_id: String, initial: &[Value]) -> Result<Vec<Value>, String> {
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
        let mut l = self.list.lock().unwrap();
        let want = json!({"file": file, "key": key});
        let defs = defaults();
        let def = l.iter().chain(initial).chain(&defs).find(|d| same_item(d, &want)).cloned();
        let label = match (&def, b["named"].as_bool().unwrap_or(false)) {
            (Some(d), false) => d["label"].as_str().unwrap_or(""),
            _ => b["label"].as_str().unwrap_or(""),
        };
        let scale = def.as_ref().and_then(|d| d["scale"].as_f64());
        let fmt = def.as_ref().and_then(|d| d["fmt"].as_str()).or(fmt);
        let item = p(&new_id, scope, place, label, file, key, scale, fmt);
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

    /// 初期値に戻す（initial の pins）。
    pub fn reset(&self, initial: Vec<Value>) -> Vec<Value> {
        let mut l = self.list.lock().unwrap();
        *l = initial;
        self.save(&l);
        l.clone()
    }
}

/// 開発者の初期値のファイルの名前（共有の置き場と、この PC の写し）。
const INITIAL_FILE: &str = "pins-default.json";

/// 初期値のファイルを読む: Ok(None)＝無い、Err＝読めない・形が違う。
fn read_initial(f: &Path) -> Result<Option<Value>, String> {
    let b = match std::fs::read(f) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: 読めません（{e}）", f.display())),
    };
    let v: Value = serde_json::from_slice(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b))
        .map_err(|e| format!("{}: 形が違います（{e}）", f.display()))?;
    let pins = checked(v["pins"].as_array().map(Vec::as_slice).unwrap_or_default());
    if pins.is_empty() {
        return Err(format!("{}: 表示項目がありません", f.display()));
    }
    Ok(Some(json!({"pins": pins, "setBy": v["setBy"], "setAt": v["setAt"], "version": v["version"]})))
}

/// 表示先に置ける物だけ（id・表示先・種類がそろい、id が重ならない）。
fn checked(pins: &[Value]) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    pins.iter()
        .filter(|p| {
            let ok = !id(p).is_empty() && compatible(p["scope"].as_str().unwrap_or(""), p["place"].as_str().unwrap_or(""));
            ok && seen.insert(id(p).to_string())
        })
        .cloned()
        .collect()
}

fn write_atomic(f: &Path, v: &Value) -> Result<(), String> {
    let dir = f.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
    let tmp = f.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec_pretty(v).unwrap_or_default()).map_err(|e| format!("{} に書けません: {e}", tmp.display()))?;
    std::fs::rename(&tmp, f).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{} を置き換えられません: {e}", f.display())
    })
}

/// 表示の初期値の置き場: home＝この PC の作業場所（写し）、shared＝共有の置き場（届かなければ None）。
pub struct Initial<'a> {
    pub home: &'a Path,
    pub shared: Option<&'a Path>,
}

impl Initial<'_> {
    /// いまの初期値: {source: developer（開発者が決めた）| builtin（アプリに入った）, pins, setBy, setAt, version,
    /// shared（共有の置き場に届くか）, copy（届かず、この PC の写しを使った）, problem（読めなかった理由）}。
    /// 共有の置き場に届けば、写しをそろえる（開発者が消したら写しも消す）。
    pub fn get(&self) -> Value {
        let copy = self.home.join(INITIAL_FILE);
        let builtin = |problem: Option<String>| json!({"source": "builtin", "pins": defaults(), "problem": problem});
        let mut out = match self.shared.map(|d| read_initial(&d.join(INITIAL_FILE))) {
            Some(Ok(Some(mut v))) => {
                if read_initial(&copy).ok().flatten().as_ref() != Some(&v) {
                    let _ = write_atomic(&copy, &v);
                }
                v["source"] = json!("developer");
                v["copy"] = json!(false);
                v
            }
            Some(Ok(None)) => {
                let _ = std::fs::remove_file(&copy);
                builtin(None)
            }
            Some(Err(e)) => builtin(Some(e)),
            None => match read_initial(&copy) {
                Ok(Some(mut v)) => {
                    v["source"] = json!("developer");
                    v["copy"] = json!(true);
                    v
                }
                _ => builtin(None),
            },
        };
        out["shared"] = json!(self.shared.is_some());
        out
    }

    /// 初期値の表示項目だけ（新しい PC の始め・初期化）。
    pub fn pins(&self) -> Vec<Value> {
        self.get()["pins"].as_array().cloned().unwrap_or_else(defaults)
    }

    /// いまの表示（pins）を開発者の初期値にする。開発者だけ。→ いまの初期値
    pub fn set(&self, pins: &[Value], by: &str, developer: bool) -> Result<Value, String> {
        if !developer {
            return Err("表示の初期値を決められるのは開発者だけです".into());
        }
        let dir = self.shared.ok_or("共有の置き場に届きません（表示の初期値は、更新の置き場〈BOX〉に置きます）")?;
        let pins = checked(pins);
        if pins.is_empty() {
            return Err("表示項目が 1 つもありません".into());
        }
        let v = json!({"schema": 1, "pins": pins, "setBy": by, "setAt": chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
                       "version": env!("CARGO_PKG_VERSION")});
        write_atomic(&dir.join(INITIAL_FILE), &v)?;
        Ok(self.get())
    }

    /// 開発者の初期値をやめ、アプリに入った物に戻す。開発者だけ。→ いまの初期値
    pub fn clear(&self, developer: bool) -> Result<Value, String> {
        if !developer {
            return Err("表示の初期値を決められるのは開発者だけです".into());
        }
        let dir = self.shared.ok_or("共有の置き場に届きません")?;
        match std::fs::remove_file(dir.join(INITIAL_FILE)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("{}: 消せません（{e}）", dir.join(INITIAL_FILE).display())),
        }
        Ok(self.get())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("dt-pins-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_initial_value_is_the_developers_when_set_else_the_built_in_one() {
        let d = tmp("initial");
        let (home, shared) = (d.join("home"), d.join("shared"));
        let ini = Initial { home: &home, shared: Some(&shared) };
        assert_eq!(ini.get()["source"], "builtin");
        assert_eq!(ini.pins(), defaults());
        let mine = vec![defaults()[0].clone(), p("p_1", "image", "card", "幅", D, "w", None, None)];
        assert!(ini.set(&mine, "dev", false).is_err(), "開発者でなければ決められない");
        let v = ini.set(&mine, "dev", true).unwrap();
        assert_eq!((v["source"].as_str(), v["setBy"].as_str()), (Some("developer"), Some("dev")));
        assert_eq!(ini.pins(), mine);
        // 共有の置き場に届かない PC は、この PC の写しを使う
        let off = Initial { home: &home, shared: None };
        assert_eq!((off.get()["copy"].as_bool(), off.pins()), (Some(true), mine.clone()));
        // 開発者がやめたら、写しも消えてアプリに入った物に戻る
        assert_eq!(ini.clear(true).unwrap()["source"], "builtin");
        assert_eq!(off.pins(), defaults());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_new_pc_starts_from_the_initial_value_and_its_own_pins_come_first() {
        let d = tmp("load");
        let mine = vec![p("p_1", "image", "card", "幅", D, "w", None, None)];
        let pins = Pins::load(&d, || mine.clone());
        assert_eq!(pins.snapshot(), mine, "新しい PC は初期値で始まる");
        pins.delete("p_1");
        let again = Pins::load(&d, || panic!("この PC の表示があれば初期値は見ない"));
        assert!(again.snapshot().is_empty());
        assert_eq!(again.reset(defaults()), defaults());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_broken_initial_file_falls_back_to_the_built_in_one_and_says_why() {
        let d = tmp("broken");
        std::fs::write(d.join(INITIAL_FILE), "{").unwrap();
        let v = Initial { home: &d.join("home"), shared: Some(&d) }.get();
        assert_eq!(v["source"], "builtin");
        assert!(v["problem"].as_str().unwrap().contains("形が違います"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_same_item_keeps_one_name_and_one_unit_wherever_it_is_placed() {
        let d = tmp("same");
        let pins = Pins::load(&d, defaults);
        // データ項目の窓から（元の名前「検査停止測長」で）置いても、既定の「検査長(m)」と同じ名前・倍率になる
        let b = json!({"scope": "lot", "place": "list", "file": I, "key": "insp_end_y", "label": "検査停止測長"});
        let l = pins.add(&b, "p_1".into(), &[]).unwrap();
        let x = l.iter().find(|x| id(x) == "p_1").unwrap();
        assert_eq!((x["label"].as_str(), x["scale"].as_f64()), (Some("検査長(m)"), Some(0.001)));
        // 利用者が名前を付けたときは名前だけその物、単位は同じ
        let b = json!({"scope": "lot", "place": "lot", "file": I, "key": "insp_end_y", "label": "停止まで", "named": true});
        let l = pins.add(&b, "p_2".into(), &[]).unwrap();
        let x = l.iter().find(|x| id(x) == "p_2").unwrap();
        assert_eq!((x["label"].as_str(), x["scale"].as_f64()), (Some("停止まで"), Some(0.001)));
        // 決まりの無い項目は送られた名前のまま・倍率なし
        let b = json!({"scope": "lot", "place": "lot", "file": I, "key": "cycle_status", "label": "周期発生状態"});
        let l = pins.add(&b, "p_3".into(), &[]).unwrap();
        let x = l.iter().find(|x| id(x) == "p_3").unwrap();
        assert_eq!((x["label"].as_str(), x.get("scale")), (Some("周期発生状態"), None));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn items_added_without_the_unit_before_4_6_1_get_the_default_name_and_unit_back() {
        let d = tmp("migrate");
        let old = json!([
            p("p_old", "lot", "list", "検査停止測長", I, "insp_end_y", None, None),
            p("p_mine", "lot", "lot", "周期", I, "cycle_status", None, None)
        ]);
        std::fs::write(d.join("pins.json"), old.to_string()).unwrap();
        let l = Pins::load(&d, || unreachable!()).snapshot();
        let x = l.iter().find(|x| id(x) == "p_old").unwrap();
        assert_eq!((x["label"].as_str(), x["scale"].as_f64()), (Some("検査長(m)"), Some(0.001)));
        assert_eq!(l.iter().find(|x| id(x) == "p_mine").unwrap()["label"], "周期");
        assert_eq!(wild("a/comment[12]@value"), "a/comment[*]@value");
        let _ = std::fs::remove_dir_all(&d);
    }
}
