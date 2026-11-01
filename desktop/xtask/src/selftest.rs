//! 本物の窓の自己診断（DT_SELFTEST）の下準備と、結果の読み取り。
//!
//! ```text
//! cargo xtask selftest-config <試験のロットの場所> <作業場所> [<更新の置き場>]   作業場所の config.json を書く（試験のロットを設備にする）
//! cargo xtask selftest-report <結果の JSON>                                      結果を PASS/FAIL で出す（通らなければ終了コード 1）
//! ```

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// 自己診断・更新の通しで使う設定（作業場所の config.json）を書く。→ 書いた場所
pub fn write_config(fixture: &Path, home: &Path, update_source: Option<&str>) -> Result<PathBuf, String> {
    let root = std::path::absolute(fixture).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(home).map_err(|e| format!("{}: {e}", home.display()))?;
    let home = std::path::absolute(home).map_err(|e| e.to_string())?;
    let cfg = json!({
        "equipments": [{"name": "LS3", "path": root.join("LS3")}, {"name": "DL2", "path": root.join("DL2")}],
        "update_source": update_source.unwrap_or(""),
    });
    let p = home.join("config.json");
    std::fs::write(&p, crate::bundle::pretty(&cfg)).map_err(|e| e.to_string())?;
    Ok(p)
}

/// 自己診断の結果を出す。→ 通ったか
pub fn report(path: &Path) -> Result<bool, String> {
    let text = std::fs::read_to_string(path).map_err(|_| format!("結果のファイルがありません: {}", path.display()))?;
    let r: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    for x in r["results"].as_array().into_iter().flatten() {
        let ok = x["ok"].as_bool() == Some(true);
        println!("{} {} -- {}", if ok { "PASS" } else { "FAIL" }, x["name"].as_str().unwrap_or(""), info(&x["info"]));
    }
    if let Some(e) = r.get("error").filter(|e| !e.is_null()) {
        println!("ERROR: {}", info(e));
    }
    Ok(r["ok"].as_bool() == Some(true))
}

/// 値を短い字に（字はそのまま、ほかは JSON）
pub fn info(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}
