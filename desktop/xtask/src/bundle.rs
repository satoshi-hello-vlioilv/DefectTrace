//! 配る ZIP を組み立てる（窓の exe と、アプリ program）。配り方は program/docs/DISTRIBUTION.md。
//!
//! ```text
//! cargo xtask brand <項目>                      名前の定義（program/app/brand.json）の値を出す（CI が名前を書き写さない）
//! cargo xtask bundle --exe <exe> --out <出力先> 配る ZIP と release.json・.sha256 を作る
//! cargo xtask version                           アプリの版（program/app/version.json）を出す（Releases の札 v<版> に使う）
//! cargo xtask notes --release <release.json> [--out <ファイル>]   Releases の説明（その版の更新履歴・配り方・指紋）を出す
//! ```
//!
//! 配る形（ZIP の中。先頭のフォルダはアプリ名）:
//! ```text
//! <name>/<exe>          窓（Rust。検査データ・画像・解析も exe の中）。上へたどって program/app/static/index.html を探す
//! <name>/program/       画面と設定の既定（git ls-files の program/app・program/config。試験・道具・説明は入れない）
//!                       ＋ 版 4.8.0 までの窓のための program/app/version.py（version.json から作る）
//! <name>/README.md
//! ```

use crate::version::{self, Entry, LEGACY_VERSION_FILE};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// 取り込む側（desktop/src/update.rs）が断る大きさ
const MAX_BYTES: u64 = 1 << 30;
/// 配る物（画面・名前・版・設定の既定）
const SHIP: [&str; 2] = ["program/app/", "program/config/"];

/// 名前の定義（_ で始まる項目は説明なので除く）
pub fn brand(program: &Path) -> Result<Map<String, Value>, String> {
    let p = program.join("app").join("brand.json");
    let v: Value = serde_json::from_slice(&std::fs::read(&p).map_err(|e| format!("{}: {e}", p.display()))?).map_err(|e| e.to_string())?;
    let mut m = v.as_object().cloned().ok_or("brand.json が {…} ではありません")?;
    m.retain(|k, _| !k.starts_with('_'));
    Ok(m)
}

fn text(b: &Map<String, Value>, key: &str) -> String {
    b.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

/// release.json の zip・exe は 1 つの名前（区切り・..・ドライブ名を含まない）。
pub fn safe_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':']) && name == name.trim()
}

/// 配る形に、いまの exe と同じ中身で置く前の名前の exe（brand.json の legacy_exe。名前の歴史）。
pub fn legacy_exe(b: &Map<String, Value>) -> Result<Vec<String>, String> {
    let exe = text(b, "exe");
    let out: Vec<String> = b
        .get("legacy_exe")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|x| *x != exe)
        .map(String::from)
        .collect();
    if !out.iter().all(|x| safe_name(x) && x.to_lowercase().ends_with(".exe")) {
        return Err(format!("brand.json の legacy_exe に使えない名前があります: {out:?}"));
    }
    Ok(out)
}

/// 版のフォルダの目印（desktop/src/release.rs が読む形・schema 1）。並びは書く順
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ReleaseJson {
    pub schema: u32,
    pub app_id: String,
    pub name: String,
    pub version: String,
    pub zip: String,
    pub sha256: String,
    pub exe: String,
}

pub fn release_json(b: &Map<String, Value>, version: &str, zip_name: &str, sha: &str) -> Result<ReleaseJson, String> {
    let exe = text(b, "exe");
    if !(safe_name(zip_name) && safe_name(&exe)) {
        return Err(format!("名前に使えない文字があります: {zip_name} / {exe}"));
    }
    Ok(ReleaseJson {
        schema: 1,
        app_id: text(b, "app_id"),
        name: text(b, "name"),
        version: version.into(),
        zip: zip_name.into(),
        sha256: sha.into(),
        exe,
    })
}

/// 1 字下げの JSON（人が読む物）＋ 改行
pub fn pretty<T: Serialize>(v: &T) -> String {
    let mut buf = vec![];
    let mut s = serde_json::Serializer::with_formatter(&mut buf, serde_json::ser::PrettyFormatter::with_indent(b" "));
    v.serialize(&mut s).expect("JSON");
    String::from_utf8(buf).unwrap() + "\n"
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

/// GitHub Releases の説明（Markdown）。その版の更新履歴・配り方（README の「更新のしかた」と同じ言葉）・指紋。
/// 更新履歴にその版が無ければ止める（版を上げずに書き忘れた）。
pub fn release_notes(rel: &ReleaseJson, history: &[Entry]) -> Result<String, String> {
    let entry = history
        .iter()
        .find(|e| e.version == rel.version)
        .ok_or_else(|| format!("更新履歴（program/app/version.json の changelog）に版 {} がありません", rel.version))?;
    let mut lines = vec![format!("## 版 {}（{}）", rel.version, entry.date), String::new(), "### 変わったこと".into()];
    lines.extend(entry.notes.iter().map(|n| format!("- {n}")));
    lines.extend([
        String::new(),
        "### 配り方".into(),
        String::new(),
        format!("1. 下の `{}` を取ります（`release.json`・`.sha256` も同じ版の物です）。", rel.zip),
        "2. アプリの「配布」→「ZIP から版を置く…」で選ぶと、中身を確かめてから更新の置き場に版のフォルダを作ります。置いただけでは配りません。".into(),
        "3. 試してから、一覧の「この版を配る」を押します。各 PC は起動したとき・30 分ごとに確かめ、開き直したときにこの版になります。".into(),
        String::new(),
        format!("指紋（SHA-256）: `{}`", rel.sha256),
        String::new(),
    ]);
    Ok(lines.join("\n"))
}

/// 配るアプリのファイル（git が知っている物だけ。.py は入れない）。リポジトリからの場所
pub fn program_files(repo: &Path) -> Result<Vec<String>, String> {
    let out = std::process::Command::new("git")
        .args(["ls-files", "-z", "program"])
        .current_dir(repo)
        .output()
        .map_err(|e| format!("git を起こせません: {e}"))?;
    if !out.status.success() {
        return Err(format!("git ls-files: {}", String::from_utf8_lossy(&out.stderr)));
    }
    let mut files: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|p| SHIP.iter().any(|s| p.starts_with(s)) && !p.ends_with(".py"))
        .map(String::from)
        .collect();
    files.sort();
    Ok(files)
}

/// フォルダの中のファイル（名前順。区切りは /）
pub fn walk(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                out.push((p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"), p));
            }
        }
    }
    out.sort();
    out
}

/// ZIP に書くファイルの権限。Unix は実際の権限（exe の実行の権限を、取り込んだ先でも保つ）。
/// Windows は権限を持たないので、Python の zipfile と同じく実行できる名前（.exe など）に実行の権限を付ける。
fn mode_of(p: &Path) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(m) = std::fs::metadata(p) {
            return m.permissions().mode() & 0o777;
        }
    }
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if matches!(ext.as_str(), "exe" | "bat" | "cmd" | "com") {
        0o755
    } else {
        0o644
    }
}

/// root の中身を top/… として ZIP にする（並びは名前順・権限を保つ）。→ ファイルの数
pub fn zip_dir(root: &Path, top: &str, out: &Path) -> Result<usize, String> {
    let files = walk(root);
    let mut z = zip::ZipWriter::new(std::fs::File::create(out).map_err(|e| format!("{}: {e}", out.display()))?);
    let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).compression_level(Some(9));
    for (rel, p) in &files {
        z.start_file(format!("{top}/{rel}"), opt.unix_permissions(mode_of(p))).map_err(|e| e.to_string())?;
        z.write_all(&std::fs::read(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    z.finish().map_err(|e| e.to_string())?;
    Ok(files.len())
}

fn copy(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(d) = to.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::copy(from, to).map(|_| ()).map_err(|e| format!("{} → {}: {e}", from.display(), to.display()))
}

/// 作った物の要約（release.json の中身 ＋ ZIP の場所・数・大きさ・組み立てたフォルダ）
#[derive(Serialize, Debug)]
pub struct Built {
    #[serde(flatten)]
    pub release: ReleaseJson,
    pub path: PathBuf,
    pub files: usize,
    pub bytes: u64,
    pub stage: PathBuf,
}

pub fn build(exe: &Path, out: &Path) -> Result<Built, String> {
    let repo = version::repo();
    let program = repo.join("program");
    let b = brand(&program)?;
    let ver = version::read(&program)?.version;
    let (name, exe_name) = (text(&b, "name"), text(&b, "exe"));
    let stage = out.join("stage").join(&name);
    let _ = std::fs::remove_dir_all(out.join("stage"));
    std::fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    copy(exe, &stage.join(&exe_name))?;
    for old in legacy_exe(&b)? {
        // 名前の歴史: 前の版の窓は入れ替えたあと前の名前の exe で開き直す（無いと開き直せずショートカットも切れる）
        copy(exe, &stage.join(old))?;
    }
    for rel in program_files(&repo)? {
        copy(&repo.join(&rel), &stage.join(&rel))?;
    }
    // 版 4.8.0 までの窓は、取り込む版を program/app/version.py で確かめる（無いと古い PC が更新できない）
    std::fs::write(stage.join("program").join(LEGACY_VERSION_FILE), version::legacy_version_py(&ver)).map_err(|e| e.to_string())?;
    copy(&repo.join("README.md"), &stage.join("README.md"))?;
    let zip_name = format!("{name}-{ver}-windows.zip");
    let zpath = out.join(&zip_name);
    let n = zip_dir(&stage, &name, &zpath)?;
    let bytes = std::fs::metadata(&zpath).map_err(|e| e.to_string())?.len();
    if bytes > MAX_BYTES {
        return Err("配る ZIP が 1 GB を超えました（取り込む側が断ります）".into());
    }
    let sha = sha256_file(&zpath)?;
    let rel = release_json(&b, &ver, &zip_name, &sha)?;
    std::fs::write(out.join("release.json"), pretty(&rel)).map_err(|e| e.to_string())?;
    std::fs::write(out.join(format!("{zip_name}.sha256")), format!("{sha}  {zip_name}\n")).map_err(|e| e.to_string())?;
    Ok(Built { release: rel, path: zpath, files: n, bytes, stage })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b() -> Map<String, Value> {
        brand(&version::program()).unwrap()
    }

    #[test]
    fn release_json_matches_what_the_window_reads() {
        let b = b();
        let r = release_json(&b, "3.9.0", &format!("{}-3.9.0-windows.zip", text(&b, "name")), &"a".repeat(64)).unwrap();
        let v = serde_json::to_value(&r).unwrap();
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys.len(), 7);
        assert_eq!((r.schema, r.app_id.as_str(), r.exe.as_str()), (1, text(&b, "app_id").as_str(), text(&b, "exe").as_str()));
        for bad in ["../x.zip", "a/b.zip", "a\\b.zip", "C:x.zip", " x.zip", ".."] {
            assert!(release_json(&b, "3.9.0", bad, &"a".repeat(64)).is_err(), "{bad}");
        }
        assert!(pretty(&r).starts_with("{\n \"schema\": 1,\n \"app_id\""), "書く順");
    }

    /// 名前の歴史: 前の名前の exe は、いまの exe と別の 1 つの名前。使えない名前は断る。
    #[test]
    fn legacy_exe_names() {
        let mut b = b();
        let exe = text(&b, "exe");
        assert!(!legacy_exe(&b).unwrap().contains(&exe));
        b.insert("legacy_exe".into(), serde_json::json!([exe, "Old.exe"]));
        assert_eq!(legacy_exe(&b).unwrap(), ["Old.exe"], "いまの名前は除く");
        for bad in ["../Old.exe", "a\\b.exe", "Old.txt"] {
            b.insert("legacy_exe".into(), serde_json::json!([bad]));
            assert!(legacy_exe(&b).is_err(), "{bad}");
        }
    }

    #[test]
    fn zip_has_one_top_folder_in_name_order() {
        let tmp = std::env::temp_dir().join(format!("dt-xtask-zip-{}", std::process::id()));
        let root = tmp.join("stage");
        std::fs::create_dir_all(root.join("program").join("app")).unwrap();
        std::fs::write(root.join("program").join("index.html"), "x").unwrap();
        std::fs::write(root.join("program").join("app").join("日本.txt"), "y").unwrap();
        std::fs::write(root.join("A.exe"), "MZ").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(root.join("A.exe"), std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let out = tmp.join("a.zip");
        assert_eq!(zip_dir(&root, "App", &out).unwrap(), 3);
        let mut z = zip::ZipArchive::new(std::fs::File::open(&out).unwrap()).unwrap();
        let names: Vec<String> = (0..z.len()).map(|i| z.by_index(i).unwrap().name().unwrap().to_string()).collect();
        assert_eq!(names, ["App/A.exe", "App/program/app/日本.txt", "App/program/index.html"], "1 つの先頭フォルダ・名前順");
        assert_eq!(z.by_index(0).unwrap().unix_mode().map(|m| m & 0o777), Some(0o755), "exe は実行できるまま（取り込んだ先で開ける）");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn release_notes_carry_this_versions_changelog_and_fingerprint() {
        let b = b();
        let v = version::read(&version::program()).unwrap();
        let rel = release_json(&b, &v.version, &format!("{}-{}-windows.zip", text(&b, "name"), v.version), &"a".repeat(64)).unwrap();
        let notes = release_notes(&rel, &v.changelog).unwrap();
        assert!(notes.starts_with(&format!("## 版 {}（", v.version)));
        for n in &v.changelog[0].notes {
            assert!(notes.contains(&format!("- {n}")));
        }
        assert!(notes.contains(&rel.zip) && notes.contains(&"a".repeat(64)));
        let err = release_notes(&ReleaseJson { version: "0.0.1".into(), ..rel }, &v.changelog).unwrap_err();
        assert!(err.contains("更新履歴"));
    }

    #[test]
    fn program_files_are_tracked_files_without_tools() {
        let files = program_files(&version::repo()).unwrap();
        for f in ["program/app/static/index.html", "program/app/brand.json", "program/app/version.json", "program/config/config.json"] {
            assert!(files.iter().any(|x| x == f), "{f}");
        }
        assert!(!files.iter().any(|f| f.ends_with(".py") || f.contains("__pycache__")), "Python の物は配らない");
        assert!(!files
            .iter()
            .any(|f| f.starts_with("program/tests/") || f.starts_with("program/tools/") || f.starts_with("program/docs/")));
    }
}
