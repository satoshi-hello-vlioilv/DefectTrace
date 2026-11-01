//! 作る・配る・試すための作業用の道具（Python の道具〈版 4.8.0 まで〉を Rust にした物）。入口は src/main.rs（cargo xtask）。
//!
//! - icon: アプリのアイコンを描く（desktop/build.rs が作るたびに呼ぶ）
//! - fixture: 試験のロットを作る（正解データとの突き合わせ・自己診断・画面の撮影）。pyrand: Python と同じ乱数
//! - version: 版の管理（version.json の release・配る物の要約）
//! - bundle: 配る ZIP・release.json・Releases の説明
//! - selftest: 本物の窓の自己診断の設定と結果
//! - verify: 本物の窓での更新の通し

pub mod icon;

#[cfg(feature = "tools")]
pub mod bundle;
#[cfg(feature = "tools")]
pub mod fixture;
#[cfg(feature = "tools")]
pub mod pyrand;
#[cfg(feature = "tools")]
pub mod selftest;
#[cfg(feature = "tools")]
pub mod verify;
#[cfg(feature = "tools")]
pub mod version;
