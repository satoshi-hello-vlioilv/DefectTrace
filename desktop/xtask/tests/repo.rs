//! 版の管理（program/app/version.json・配る物の要約）。版を上げずにプログラムを変えて配ることを止める。

use std::collections::HashSet;
use xtask::version::{self, read, release_digest, release_files, version_key};

const HOW: &str =
    "program/app/version.json の version を上げて changelog の先頭に 1 件足し、`cd desktop && cargo xtask release` で記録してください\
                   （まだ配っていない版を直しただけなら `cargo xtask release --amend`）。";

#[test]
fn changelog_head_is_the_app_version() {
    let v = read(&version::program()).unwrap();
    assert!(version_key(&v.version).is_some() && v.version.split('.').count() == 3, "版は 大.中.小: {}", v.version);
    assert_eq!(v.changelog[0].version, v.version, "changelog の先頭にいまの版の 1 件を足してください");
}

#[test]
fn changelog_is_newest_first_and_filled() {
    let v = read(&version::program()).unwrap();
    let keys: Vec<_> = v.changelog.iter().map(|e| version_key(&e.version).unwrap_or_else(|| panic!("版の形: {}", e.version))).collect();
    assert!(keys.windows(2).all(|w| w[0] > w[1]), "新しい版を上に・同じ版を 2 つ書かない");
    let dates: Vec<_> = v
        .changelog
        .iter()
        .map(|e| chrono::NaiveDate::parse_from_str(&e.date, "%Y-%m-%d").unwrap_or_else(|_| panic!("日付の形: {}", e.date)))
        .collect();
    assert!(dates.windows(2).all(|w| w[0] >= w[1]), "日付も新しい順");
    for e in &v.changelog {
        assert!(!e.notes.is_empty() && e.notes.iter().all(|n| !n.trim().is_empty()), "{} の notes", e.version);
    }
}

#[test]
fn program_matches_the_recorded_release() {
    let p = version::program();
    let v = read(&p).unwrap();
    assert_eq!(v.release.version, v.version, "版 {} がまだ記録されていません。{HOW}", v.version);
    assert_eq!(v.release.digest, release_digest(&p), "版 {} を記録したあとにプログラムが変わっています。{HOW}", v.version);
}

#[test]
fn digest_covers_what_is_shipped() {
    let files: HashSet<String> = release_files(&version::program()).into_keys().collect();
    assert!(!files.contains(version::VERSION_FILE), "release を書くと要約が変わってしまう");
    assert!(files.contains("app/static/app.js") && files.contains("config/config.json"));
    assert!(
        !files.iter().any(|k| k.starts_with("tests/") || k.starts_with("docs/") || k.starts_with("tools/") || k.ends_with(".md")),
        "説明・試験・道具は含めない"
    );
}

/// 窓（desktop/）の版はアプリの版と同じ（窓の版と中身の版がずれない）。
#[test]
fn desktop_has_the_same_version() {
    let want = read(&version::program()).unwrap().version;
    let desktop = version::repo().join("desktop");
    let cargo = std::fs::read_to_string(desktop.join("Cargo.toml")).unwrap();
    let cargo = cargo.lines().find_map(|l| l.strip_prefix("version = \"")?.strip_suffix('"')).unwrap().to_string();
    let conf: serde_json::Value = serde_json::from_slice(&std::fs::read(desktop.join("tauri.conf.json")).unwrap()).unwrap();
    assert_eq!(
        (cargo.as_str(), conf["version"].as_str().unwrap()),
        (want.as_str(), want.as_str()),
        "desktop/Cargo.toml と tauri.conf.json の version をアプリの版に合わせてください"
    );
}
