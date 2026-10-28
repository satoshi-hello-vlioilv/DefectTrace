//! 設定（設備の置き場・ロットの名前の形・多量の判定・更新の置き場など）。
//!
//! 重ね方: 組み込みの既定 ← 配る物の `program/config/config.json` ← この PC の作業場所の `config.json`（利用者が直す物）。
//! 作業場所の config.json が無ければ、配る物の config.json を写して作る（直す場所を探させない）。
//! 表示項目（pins.json）も作業場所に置く（版を入れ替えても消えない）。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// 更新の置き場の既定（LotScope と同じ置き場。この下の DefectTrace\versions\<版> に版を置く）。設定の update_source が空ならここ。
/// BOX の見え方が PC で違っても（上の階層が見えないなど）、release::resolve_source が見える場所を探し直す。
pub const DEFAULT_UPDATE_SOURCE: &str = r"C:\boxdrive\Box\(D)_仕上課\90_アプリ開発\90_Releases";

/// 組み込みの既定（版 3.8 の DEFAULT_CFG と同じ）。
pub fn defaults() -> Value {
    json!({
        "equipments": [],
        "lot_regex": r"^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$",
        "link_map": {"img": "IMAGE_LINK", "fm_img": "FM_IMAGE_LINK"},
        "xml_defs": {"cond/COND*.xml": "InspCondDef.xml", "cond/Common.xml": "InspCondDef.xml", "cond/SystemCond.xml": "SystemCondDef.xml"},
        "kind_names": {},
        "defs_dir": "",
        "image_xml_patterns": [],
        "cache_dir": "",
        "cache_keep_lots": 30,
        "workers": 0,
        "thumb_size": 256,
        "work_info_csv": "",
        "utc_offset_hours": 9,
        "overload_names": ["多量"],
        "overload_types": [2],
        "overload_kind_ids": [1100],
        "time_warn_minutes": 10,
        "update_source": "",
        "release_users": [],
        "memory_mb": 160,
    })
}

/// だれか（Config::who）。
#[derive(Debug, Clone, Default)]
pub struct Who {
    /// ログイン名（権限の見分けに使う。設定では変えられない）
    pub login: String,
    /// PC の名前（設定の pc_name で上書きできる）と、どこから取ったか
    pub pc: String,
    pub pc_source: &'static str,
    /// 開発者か（release_users に名前がある・release_users が空）
    pub developer: bool,
    pub users: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub v: Value,
    /// 利用者の設定・表示項目・記録を置く場所（作業場所）
    pub home: PathBuf,
}

fn read(p: &Path) -> Option<Value> {
    let b = std::fs::read(p).ok()?;
    serde_json::from_slice::<Value>(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b)).ok().filter(Value::is_object)
}

fn merge(base: &mut Value, over: &Value) {
    if let (Some(b), Some(o)) = (base.as_object_mut(), over.as_object()) {
        for (k, v) in o {
            b.insert(k.clone(), v.clone());
        }
    }
}

impl Config {
    /// shipped: 配る物の config.json（無くてよい）。home: 作業場所。
    pub fn load(shipped: Option<&Path>, home: &Path) -> Config {
        let mut v = defaults();
        let shipped_v = shipped.and_then(read);
        if let Some(s) = &shipped_v {
            merge(&mut v, s);
        }
        let mine = home.join("config.json");
        match read(&mine) {
            Some(m) => merge(&mut v, &m),
            None => {
                if let Some(s) = &shipped_v {
                    let _ = std::fs::create_dir_all(home);
                    let _ = std::fs::write(&mine, serde_json::to_vec_pretty(s).unwrap_or_default());
                }
            }
        }
        Config { v, home: home.to_path_buf() }
    }

    pub fn from_value(v: Value, home: &Path) -> Config {
        let mut base = defaults();
        merge(&mut base, &v);
        Config { v: base, home: home.to_path_buf() }
    }

    pub fn str(&self, k: &str) -> String {
        self.v[k].as_str().unwrap_or("").to_string()
    }
    pub fn f64(&self, k: &str, d: f64) -> f64 {
        self.v[k].as_f64().unwrap_or(d)
    }
    pub fn ints(&self, k: &str) -> Vec<i64> {
        self.v[k].as_array().map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default()
    }
    pub fn strs(&self, k: &str) -> Vec<String> {
        self.v[k].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
    }

    /// 縮小画像・展開した画像の置き場（設定が空なら作業場所の cache）。
    pub fn cache_dir(&self) -> PathBuf {
        match self.str("cache_dir") {
            s if s.trim().is_empty() => self.home.join("cache"),
            s => PathBuf::from(s),
        }
    }

    /// 裏の仕事の数（0 = この PC の芯の数に合わせる）。
    pub fn workers(&self) -> usize {
        match self.v["workers"].as_u64().unwrap_or(0) as usize {
            0 => std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 16),
            n => n.clamp(1, 64),
        }
    }

    /// だれか（Windows のログイン名・PC の名前）と、開発者か（版を置く・配る・既定のフィルタを決める）。
    /// 開発者は設定の release_users に名前がある人。release_users が空なら、だれでも（置き場へ書ける人）。
    /// だれが・どの PC で使っているか。ログイン名は USERNAME → USER → LOGNAME の順、PC の名前は 設定の pc_name →
    /// COMPUTERNAME → HOSTNAME → /etc/hostname の順に、使える最初の物（localhost・unknown などは飛ばす。80 字まで）。
    pub fn who(&self) -> Who {
        let env = |k: &str| std::env::var(k).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let login = ["USERNAME", "USER", "LOGNAME"].iter().find_map(|k| env(k)).unwrap_or_default();
        let usable = |s: &str| {
            !s.is_empty() && !["localhost", "127.0.0.1", "unknown", "localhost.localdomain"].contains(&s.to_ascii_lowercase().as_str())
        };
        let hostfile = || std::fs::read_to_string("/etc/hostname").ok().map(|s| s.trim().to_string());
        let (pc, pc_source) = [
            (Some(self.str("pc_name").trim().to_string()), "設定"),
            (env("COMPUTERNAME"), "COMPUTERNAME"),
            (env("HOSTNAME"), "HOSTNAME"),
            (hostfile(), "/etc/hostname"),
        ]
        .into_iter()
        .find_map(|(v, src)| v.filter(|v| usable(v)).map(|v| (v.chars().take(80).collect::<String>(), src)))
        .unwrap_or_default();
        let users = self.strs("release_users");
        let developer = users.is_empty() || users.iter().any(|u| u.eq_ignore_ascii_case(&login));
        Who { login, pc, pc_source, developer, users }
    }

    /// 更新の置き場（設定が空なら既定の置き場）。
    pub fn update_source(&self) -> String {
        match self.str("update_source") {
            s if s.trim().is_empty() => DEFAULT_UPDATE_SOURCE.to_string(),
            s => s,
        }
    }

    pub fn utc_offset(&self) -> chrono::Duration {
        chrono::Duration::milliseconds((self.f64("utc_offset_hours", 9.0) * 3_600_000.0) as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_update_source_means_the_default_place() {
        let home = std::env::temp_dir();
        assert_eq!(Config::from_value(json!({"update_source": ""}), &home).update_source(), DEFAULT_UPDATE_SOURCE, "空なら既定の置き場");
        assert_eq!(Config::from_value(json!({"update_source": " "}), &home).update_source(), DEFAULT_UPDATE_SOURCE);
        assert_eq!(Config::from_value(json!({"update_source": r"\\srv\rel"}), &home).update_source(), r"\\srv\rel", "書けばそこ");
    }
}
