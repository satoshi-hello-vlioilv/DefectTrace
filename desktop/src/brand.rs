//! アプリの名前（`program/app/brand.json` の1か所の定義を、作るときに取り込む）。
//!
//! 名前（`name`・`subtitle`・`exe`）は窓の題名・起動画面・記録に使う。`app_id`・`data_dir` は変えない目印
//! （Tauri の identifier・この PC の作業場所のフォルダ名）。配る ZIP を作る道具（desktop/bundle/bundle.py）も同じファイルを読む。

use serde::Deserialize;
use std::sync::OnceLock;

const SOURCE: &str = include_str!("../../program/app/brand.json");

#[derive(Debug, Deserialize)]
pub struct Brand {
    pub name: String,
    pub subtitle: String,
    pub exe: String,
    pub app_id: String,
    pub data_dir: String,
    /// 名前の歴史: 前のアプリ名（その名前のショートカットを、いまの名前で作り直す）
    #[serde(default)]
    pub legacy_names: Vec<String>,
}

pub fn brand() -> &'static Brand {
    static B: OnceLock<Brand> = OnceLock::new();
    B.get_or_init(|| serde_json::from_str(SOURCE).expect("program/app/brand.json が読めません"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agrees_with_the_build_tools() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let b = brand();
        assert_eq!(conf["identifier"], b.app_id.as_str(), "Tauri の identifier は変えない目印（WebView の保存先が変わらない）");
        assert_eq!(conf["productName"], b.name.as_str());
        assert_eq!(format!("{}.exe", conf["mainBinaryName"].as_str().unwrap()), b.exe, "exe の名前");
        assert!(!b.data_dir.is_empty() && !b.subtitle.is_empty());
        assert!(!b.legacy_names.contains(&b.name), "名前の歴史に、いまの名前は入れない");
    }
}
