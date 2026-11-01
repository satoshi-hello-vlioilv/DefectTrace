//! 版の管理（版を上げずにプログラムを変えて配ることを止める）。版と更新履歴の正本は program/app/version.json。
//!
//! ```text
//! cargo xtask digest            いまの配る物の要約を出す
//! cargo xtask release           版を上げて更新履歴を足したあと、version.json の release を書く
//! cargo xtask release --amend   まだ配っていない版を直しただけのとき（版はそのままで要約だけ書き直す）
//! ```
//!
//! 配る物: program/app（画面・名前・版）と program/config/*.json。説明（.md）は含めない。version.json 自身も含めない
//! （release を書くと要約が変わるため）。窓（desktop/）は版を Cargo.toml・tauri.conf.json にも持ち、試験（tests/repo.rs）が同じかを見る。

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// 版と更新履歴の正本（program からの場所）
pub const VERSION_FILE: &str = "app/version.json";
/// 版 4.8.0 までの窓が、配る形の版を読むファイル（program からの場所）。配る ZIP にだけ作って入れる
pub const LEGACY_VERSION_FILE: &str = "app/version.py";

#[derive(Deserialize, Debug, Clone)]
pub struct Release {
    pub version: String,
    pub digest: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Entry {
    pub version: String,
    pub date: String,
    pub notes: Vec<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct VersionFile {
    pub version: String,
    pub release: Release,
    pub changelog: Vec<Entry>,
}

/// リポジトリの最上位（desktop/xtask の 2 つ上。CARGO_MANIFEST_DIR は絶対の場所。canonicalize は Windows で \\?\ の頭を付け、
/// git などの作業フォルダに渡すと崩れるので使わない）
pub fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().and_then(Path::parent).expect("リポジトリの場所").to_path_buf()
}

/// 配る物の置き場（リポジトリの program）
pub fn program() -> PathBuf {
    repo().join("program")
}

pub fn read(program: &Path) -> Result<VersionFile, String> {
    let p = program.join(VERSION_FILE);
    let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))
}

/// 版を数の組に（1.10.0 は 1.9.3 より新しい）。足りない桁は 0。
pub fn version_key(v: &str) -> Option<(u64, u64, u64)> {
    let mut p = v.split('.').map(|x| x.parse::<u64>().ok());
    let a = p.next()??;
    let b = p.next().unwrap_or(Some(0))?;
    let c = p.next().unwrap_or(Some(0))?;
    p.next().is_none().then_some((a, b, c))
}

/// 配る物（program からの場所 → ファイル）。名前順
pub fn release_files(program: &Path) -> BTreeMap<String, PathBuf> {
    let mut out = BTreeMap::new();
    let mut stack = vec![program.join("app")];
    let add = |p: PathBuf, out: &mut BTreeMap<String, PathBuf>| {
        let rel = p.strip_prefix(program).unwrap().to_string_lossy().replace('\\', "/");
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "pyc" | "md") && rel != VERSION_FILE {
            out.insert(rel, p);
        }
    };
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                if e.file_name() != "__pycache__" {
                    stack.push(p);
                }
            } else {
                add(p, &mut out);
            }
        }
    }
    for e in std::fs::read_dir(program.join("config")).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_file() && p.extension().is_some_and(|x| x == "json") {
            add(p, &mut out);
        }
    }
    out
}

/// 配る物の中身の要約（16 桁）。改行は LF にそろえる（Windows で取り出して CRLF になっても同じ要約）。
pub fn release_digest(program: &Path) -> String {
    let mut h = Sha256::new();
    for (rel, p) in release_files(program) {
        let body = std::fs::read(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
        let mut lf = Vec::with_capacity(body.len());
        let mut i = 0;
        while i < body.len() {
            if body[i] == b'\r' && body.get(i + 1) == Some(&b'\n') {
                i += 1;
                continue;
            }
            lf.push(body[i]);
            i += 1;
        }
        h.update(rel.as_bytes());
        h.update([0]);
        h.update(&lf);
        h.update([0]);
    }
    format!("{:x}", h.finalize())[..16].to_string()
}

/// version.json の release の行を書き直す（ほかの行は人が書いたまま残す）。
fn write_release(program: &Path, version: &str, digest: &str) -> Result<(), String> {
    let p = program.join(VERSION_FILE);
    let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let mut n = 0;
    let lines: Vec<String> = text
        .lines()
        .map(|l| {
            if l.starts_with(" \"release\":") {
                n += 1;
                format!(" \"release\": {{\"version\": \"{version}\", \"digest\": \"{digest}\"}},")
            } else {
                l.to_string()
            }
        })
        .collect();
    if n != 1 {
        return Err(format!("{VERSION_FILE} に release の行（ \"release\": {{…}},）が見つかりません。"));
    }
    std::fs::write(&p, lines.join("\n") + "\n").map_err(|e| e.to_string())
}

/// release を書く。版を上げずに中身だけ変えた記録は作らない（上げ忘れを止めるための仕組みなので）。
pub fn record_release(program: &Path, amend: bool) -> Result<String, String> {
    let v = read(program)?;
    let digest = release_digest(program);
    let (cur, rel) = (&v.version, &v.release);
    if v.changelog.first().map(|e| &e.version) != Some(cur) {
        return Err(format!("更新履歴（changelog）の先頭が版 {cur} ではありません。先頭に {cur} の1件を足してください。"));
    }
    if &rel.version == cur && rel.digest == digest {
        return Ok(format!("記録済みです（{cur}・{digest}）。"));
    }
    if &rel.version == cur && !rel.digest.is_empty() && !amend {
        return Err(format!(
            "版 {cur} は記録済みで、そのあとプログラムが変わっています。版を上げて（{VERSION_FILE} の version と changelog の先頭）からもう一度。\
             まだ配っていない {cur} を直しただけなら --amend。"
        ));
    }
    if version_key(cur) < version_key(&rel.version) {
        return Err(format!("版 {cur} が、記録済みの {} より古くなっています。", rel.version));
    }
    write_release(program, cur, &digest)?;
    Ok(format!("記録しました: {cur}・{digest}"))
}

/// 版 4.8.0 までの窓のための版のファイル（`APP_VERSION = "X.Y.Z"` の 1 行を窓が字として読む）。
pub fn legacy_version_py(version: &str) -> String {
    format!(
        "# 版 4.8.0 までの窓が、配る形の版を読むための写し（配る ZIP を作るとき version.json から作る。手で書かない）\nAPP_VERSION = \"{version}\"\n"
    )
}

/// program の版を書き換える（更新の通しで、同じ中身の別の版を作るため）。古い窓のための version.py があれば、それも。
pub fn set_version(program: &Path, version: &str) -> Result<(), String> {
    let p = program.join(VERSION_FILE);
    let mut v: serde_json::Value = serde_json::from_slice(&std::fs::read(&p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    v["version"] = serde_json::json!(version);
    std::fs::write(&p, serde_json::to_vec_pretty(&v).unwrap()).map_err(|e| e.to_string())?;
    let legacy = program.join(LEGACY_VERSION_FILE);
    if legacy.is_file() {
        std::fs::write(&legacy, legacy_version_py(version)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers() {
        assert!(version_key("1.10.0") > version_key("1.9.3"));
        assert_eq!(version_key("1.0"), Some((1, 0, 0)));
        assert_eq!(version_key("1.x"), None);
    }

    /// 記録の流れ: 上げずに変えると止める・--amend で書き直す・上げて記録する
    #[test]
    fn release_is_recorded_only_after_a_bump() {
        let d = std::env::temp_dir().join(format!("dt-xtask-ver-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("app")).unwrap();
        std::fs::create_dir_all(d.join("config")).unwrap();
        std::fs::write(d.join("app").join("a.js"), "1\r\n").unwrap();
        let file = |v: &str, rel: &str, digest: &str| {
            format!(
                "{{\n \"version\": \"{v}\",\n \"release\": {{\"version\": \"{rel}\", \"digest\": \"{digest}\"}},\n \"changelog\": [\n  {{\"version\": \"{v}\", \"date\": \"2026-11-01\", \"notes\": [\"x\"]}}\n ]\n}}\n"
            )
        };
        std::fs::write(d.join(VERSION_FILE), file("1.0.0", "1.0.0", "")).unwrap();
        assert!(record_release(&d, false).unwrap().starts_with("記録しました"));
        let first = read(&d).unwrap().release.digest;
        std::fs::write(d.join("app").join("a.js"), "1\n").unwrap();
        assert_eq!(release_digest(&d), first, "CRLF と LF は同じ要約");
        std::fs::write(d.join("app").join("a.js"), "2\n").unwrap();
        assert!(record_release(&d, false).unwrap_err().contains("版を上げて"));
        assert!(record_release(&d, true).is_ok(), "--amend");
        std::fs::write(d.join(VERSION_FILE), file("0.9.0", "1.0.0", "x")).unwrap();
        assert!(record_release(&d, false).unwrap_err().contains("古く"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
