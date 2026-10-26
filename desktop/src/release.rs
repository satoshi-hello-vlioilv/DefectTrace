//! 更新の置き場から「このアプリの版」と「配る版」を探す（program/docs/DISTRIBUTION.md）。
//!
//! 置き場の形（名前は自由・目印で見分ける）:
//! ```text
//! 90_Releases\                 ← 設定（config.json）の update_source
//!   <アプリのフォルダ>\
//!     distribute.json          { schema:1, app_id, version, entry, setAt, setBy, setPc, previous }（配る版）
//!     <版>\release.json        { schema:1, app_id, name, version, zip, sha256, exe }（版のフォルダの目印）
//!     <版>\<name>-<版>-windows.zip
//! ```
//! - 置き場の下を 3 段まで（見るフォルダは 600 個まで）たどり、目印の app_id が合うものだけを使う。点で始まるフォルダ（置いている途中）は見ない
//! - 書いた場所が無ければ、共有フォルダ・クラウドの同期フォルダ（BOX など）の見え方の違いを付け直して探す（resolve_source）。候補は「;」か改行で複数・%環境変数% も使える

use serde_json::Value;
use std::path::{Component, Path, PathBuf};

pub const MARKER: &str = "release.json";
pub const DISTRIBUTE: &str = "distribute.json";
const MAX_DEPTH: usize = 3;
const MAX_DIRS: usize = 600;

/// 版（X.Y.Z）を数の組に。形が違えば None。
pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let p: Vec<&str> = v.split('.').collect();
    if p.len() != 3 || p.iter().any(|x| x.is_empty() || x.len() > 9 || !x.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    Some((p[0].parse().ok()?, p[1].parse().ok()?, p[2].parse().ok()?))
}

/// a は b より新しいか（数で比べる: 3.10.0 は 3.9.0 より新しい）。
pub fn newer(a: &str, b: &str) -> bool {
    matches!((parse_version(a), parse_version(b)), (Some(x), Some(y)) if x > y)
}

/// 1 つの名前か（区切り・..・ドライブ名を含まない）。ZIP の名前・exe の名前に使う。
pub fn safe_name(n: &str) -> bool {
    !n.is_empty() && n != "." && n != ".." && !n.contains(['/', '\\', ':']) && n.trim() == n
}

/// 版のフォルダの目印。
#[derive(Debug, Clone, PartialEq)]
pub struct Release {
    pub dir: PathBuf,
    pub name: String,
    pub version: String,
    pub zip: String,
    pub sha256: String,
    pub exe: String,
    pub raw: Value,
}

impl Release {
    pub fn zip_path(&self) -> PathBuf {
        self.dir.join(&self.zip)
    }
}

/// release.json を読む。app_id が違えば Ok(None)（ほかのアプリ）。形が違えば理由。
pub fn read_release(dir: &Path, app_id: &str) -> Result<Option<Release>, String> {
    let file = dir.join(MARKER);
    let bytes = std::fs::read(&file).map_err(|e| format!("{}: 読めません（{e}）", file.display()))?;
    let v: Value = serde_json::from_slice(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes))
        .map_err(|e| format!("{}: 形が違います（{e}）", file.display()))?;
    if v["app_id"].as_str() != Some(app_id) {
        return Ok(None);
    }
    let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
    let bad = |why: &str| Err(format!("{}: {why}", file.display()));
    if v["schema"].as_i64() != Some(1) {
        return bad("schema が 1 ではありません");
    }
    if parse_version(&s("version")).is_none() {
        return bad("version が X.Y.Z ではありません");
    }
    if !safe_name(&s("zip")) || !safe_name(&s("exe")) {
        return bad("zip・exe が 1 つの名前ではありません");
    }
    let sha = s("sha256").to_ascii_lowercase();
    if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return bad("sha256 が 64 桁の指紋ではありません");
    }
    Ok(Some(Release { dir: dir.to_path_buf(), name: s("name"), version: s("version"), zip: s("zip"), sha256: sha, exe: s("exe"), raw: v }))
}

/// 配る版（アプリのフォルダの distribute.json）。
#[derive(Debug, Clone, PartialEq)]
pub struct Distribute {
    pub dir: PathBuf,
    pub version: String,
    pub raw: Value,
}

impl Distribute {
    pub fn set_at(&self) -> String {
        self.raw["setAt"].as_str().unwrap_or("").to_string()
    }
}

fn read_distribute(dir: &Path, app_id: &str) -> Result<Option<Distribute>, String> {
    let file = dir.join(DISTRIBUTE);
    let bytes = match std::fs::read(&file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: 読めません（{e}）", file.display())),
    };
    let v: Value = serde_json::from_slice(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes))
        .map_err(|e| format!("{}: 形が違います（{e}）", file.display()))?;
    if v["app_id"].as_str() != Some(app_id) {
        return Ok(None);
    }
    let version = v["version"].as_str().unwrap_or("").to_string();
    if v["schema"].as_i64() != Some(1) || parse_version(&version).is_none() {
        return Err(format!("{}: 形が違います（schema 1・version X.Y.Z）", file.display()));
    }
    Ok(Some(Distribute { dir: dir.to_path_buf(), version, raw: v }))
}

/// 置き場を探した結果。
#[derive(Debug, Default, Clone)]
pub struct Scan {
    pub versions: Vec<Release>,
    pub distribute: Option<Distribute>,
    pub problems: Vec<String>,
}

impl Scan {
    /// 版ごとに 1 つ（同じ版が 2 か所にあれば先に見つけた方）。新しい順。
    pub fn by_version(&self) -> Vec<&Release> {
        let mut out: Vec<&Release> = Vec::new();
        for r in &self.versions {
            if !out.iter().any(|x| x.version == r.version) {
                out.push(r);
            }
        }
        out.sort_by_key(|r| std::cmp::Reverse(parse_version(&r.version)));
        out
    }

    pub fn find(&self, version: &str) -> Option<&Release> {
        self.versions.iter().find(|r| r.version == version)
    }

    pub fn newest(&self) -> Option<&Release> {
        self.by_version().into_iter().next()
    }
}

/// 置き場の下を 3 段まで見て、このアプリの版と配る版を集める。
pub fn scan(root: &Path, app_id: &str) -> Scan {
    let mut out = Scan::default();
    let mut queue = vec![(root.to_path_buf(), 0usize)];
    let mut seen = 0usize;
    while let Some((dir, depth)) = queue.pop() {
        seen += 1;
        if seen > MAX_DIRS {
            out.problems.push(format!("見るフォルダが {MAX_DIRS} 個を超えたので、そこで止めました"));
            break;
        }
        if dir.join(MARKER).is_file() {
            match read_release(&dir, app_id) {
                Ok(Some(r)) => out.versions.push(r),
                Ok(None) => {}
                Err(e) => out.problems.push(e),
            }
            continue; // 版のフォルダの下は見ない
        }
        match read_distribute(&dir, app_id) {
            // あとで決めた方が効く（アプリ名を変えて新しいフォルダで配ったときも、新しい方）
            Ok(Some(d)) => {
                if out.distribute.as_ref().is_none_or(|cur| d.set_at() > cur.set_at()) {
                    out.distribute = Some(d);
                }
            }
            Ok(None) => {}
            Err(e) => out.problems.push(e),
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        let mut subs: Vec<PathBuf> = std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .map(|e| e.path())
            .collect();
        subs.sort();
        subs.reverse(); // pop で名前順に見る
        queue.extend(subs.into_iter().map(|p| (p, depth + 1)));
    }
    out.versions.sort_by(|a, b| a.dir.cmp(&b.dir));
    out
}

/// `%NAME%` を環境変数で展開する（無ければそのまま残す）。
pub fn expand_vars(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        match tail.find('%') {
            Some(j) => {
                let name = &tail[..j];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => out.push_str(&rest[i..i + j + 2]),
                }
                rest = &tail[j + 1..];
            }
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// 設定の値 → 候補の並び（「;」か改行で区切る・前後の空白と引用符を外す・環境変数を展開）。
pub fn candidates(source: &str) -> Vec<String> {
    source.split([';', '\n', '\r']).map(|s| s.trim().trim_matches('"').trim()).filter(|s| !s.is_empty()).map(expand_vars).collect()
}

fn names_of(p: &Path) -> Vec<String> {
    p.components().filter_map(|c| if let Component::Normal(n) = c { Some(n.to_string_lossy().into_owned()) } else { None }).collect()
}

/// 書いた場所が無ければ、その PC で実在するいちばん深いフォルダから、下の名前を付け直して探す（共有フォルダ・クラウドの同期フォルダ（BOX など）の見え方の違い）。
/// 1. 上の階層が見えない人: 下の名前を前から外す  2. 上の階層も見える人: 1 つ下のフォルダに入れる。→ (見つけた場所, 付け直したか)
pub fn resolve_source(given: &Path) -> Option<(PathBuf, bool)> {
    if given.is_dir() {
        return Some((given.to_path_buf(), false));
    }
    let base = given.ancestors().skip(1).find(|a| !a.as_os_str().is_empty() && a.is_dir())?.to_path_buf();
    let rest: Vec<String> = names_of(given.strip_prefix(&base).ok()?);
    if rest.is_empty() {
        return None;
    }
    // 1. 下の名前を前から外す（最後の名前は残す）
    for k in 1..rest.len() {
        let p = rest[k..].iter().fold(base.clone(), |a, n| a.join(n));
        if p.is_dir() {
            return Some((p, true));
        }
    }
    // 2. 1 つ下のフォルダに入れる（名前順・点で始まるフォルダは見ない）
    let mut subs: Vec<PathBuf> = std::fs::read_dir(&base)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false) && !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| e.path())
        .collect();
    subs.sort();
    for s in subs.iter().take(200) {
        let p = rest.iter().fold(s.clone(), |a, n| a.join(n));
        if p.is_dir() {
            return Some((p, true));
        }
    }
    None
}

/// 候補を前から試し、最初に見つかった置き場。→ (見つけた場所, 付け直したか)。見つからなければ理由。
pub fn locate_source(source: &str) -> Result<(PathBuf, bool), String> {
    let cands = candidates(source);
    if cands.is_empty() {
        return Err("更新の置き場が決まっていません".into());
    }
    for c in &cands {
        if let Some(found) = resolve_source(Path::new(c)) {
            return Ok(found);
        }
    }
    Err(format!("更新の置き場が見つかりません（{}）", cands.join("・")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("da-rel-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(dir: &Path, v: Value) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(MARKER), serde_json::to_vec(&v).unwrap()).unwrap();
    }

    fn rel(id: &str, ver: &str) -> Value {
        json!({"schema": 1, "app_id": id, "name": "A", "version": ver, "zip": format!("A-{ver}-windows.zip"), "sha256": "a".repeat(64), "exe": "A.exe"})
    }

    #[test]
    fn versions_compare_by_number() {
        assert!(newer("3.10.0", "3.9.0") && !newer("3.9.0", "3.9.0") && !newer("3.9", "3.8.0"));
        assert_eq!(parse_version("3.9.0"), Some((3, 9, 0)));
        assert!(parse_version("3.9.0-ci").is_none() && parse_version("3..0").is_none() && parse_version(" 3.9.0").is_none());
    }

    #[test]
    fn release_json_is_read_and_refused() {
        let d = tmp("read");
        put(&d.join("ok"), rel("me", "3.9.0"));
        assert_eq!(read_release(&d.join("ok"), "me").unwrap().unwrap().exe, "A.exe");
        assert_eq!(read_release(&d.join("ok"), "other").unwrap(), None, "ほかのアプリは数えない");
        for (k, v) in [
            ("schema", json!(2)),
            ("version", json!("3.9")),
            ("zip", json!("../x.zip")),
            ("exe", json!("C:x.exe")),
            ("exe", json!("a\\b.exe")),
            ("sha256", json!("abc")),
            ("sha256", json!("z".repeat(64))),
        ] {
            let mut r = rel("me", "3.9.0");
            r[k] = v.clone();
            put(&d.join("bad"), r);
            assert!(read_release(&d.join("bad"), "me").is_err(), "{k}={v}");
        }
        std::fs::write(d.join("bad").join(MARKER), b"{").unwrap();
        assert!(read_release(&d.join("bad"), "me").is_err(), "壊れた JSON");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn scan_finds_by_marker_and_skips_the_rest() {
        let d = tmp("scan");
        put(&d.join("AppOld").join("3.8.0"), rel("me", "3.8.0"));
        put(&d.join("AppNew").join("anything"), rel("me", "3.9.0"));
        put(&d.join("Other").join("1.0.0"), rel("other", "9.9.9"));
        put(&d.join("AppNew").join(".3.10.0.placing-1"), rel("me", "3.10.0"));
        put(&d.join("a").join("b").join("c").join("d"), rel("me", "4.0.0"));
        std::fs::write(
            d.join("AppOld").join(DISTRIBUTE),
            serde_json::to_vec(&json!({"schema":1,"app_id":"me","version":"3.8.0","setAt":"2026-10-01T00:00:00"})).unwrap(),
        )
        .unwrap();
        std::fs::write(
            d.join("AppNew").join(DISTRIBUTE),
            serde_json::to_vec(&json!({"schema":1,"app_id":"me","version":"3.9.0","setAt":"2026-10-05T00:00:00"})).unwrap(),
        )
        .unwrap();
        let s = scan(&d, "me");
        let vs: Vec<&str> = s.by_version().iter().map(|r| r.version.as_str()).collect();
        assert_eq!(vs, ["3.9.0", "3.8.0"], "名前の違うフォルダも目印で拾う・ほかのアプリ・置いている途中・深すぎるは見ない");
        assert_eq!(s.distribute.unwrap().version, "3.9.0", "あとで決めた配る版が効く");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn sources_with_vars_and_box_views() {
        std::env::set_var("DA_REL_TEST", "x");
        assert_eq!(candidates(" \"%DA_REL_TEST%\\a\" ; b\n%NO_SUCH_VAR%"), ["x\\a", "b", "%NO_SUCH_VAR%"]);
        let d = tmp("box");
        // この PC では「(D)_部署」が見えない（上の階層が見えない人）
        std::fs::create_dir_all(d.join("Box").join("90_アプリ").join("90_Releases")).unwrap();
        let given = d.join("Box").join("(D)_部署").join("90_アプリ").join("90_Releases");
        assert_eq!(resolve_source(&given), Some((d.join("Box").join("90_アプリ").join("90_Releases"), true)));
        // この PC では上の階層も見える（設定は下の名前から）
        let d2 = tmp("box2");
        std::fs::create_dir_all(d2.join("Box").join("(D)_部署").join("90_アプリ").join("90_Releases")).unwrap();
        let given = d2.join("Box").join("90_アプリ").join("90_Releases");
        assert_eq!(resolve_source(&given), Some((d2.join("Box").join("(D)_部署").join("90_アプリ").join("90_Releases"), true)));
        assert_eq!(resolve_source(&d2), Some((d2.clone(), false)), "あればそのまま");
        let src = format!("{};{}", d.join("nowhere-at-all").join("zz").display(), d.join("Box").display());
        assert_eq!(locate_source(&src).unwrap().0, d.join("Box"), "候補を前から");
        assert!(locate_source("").is_err());
        let _ = std::fs::remove_dir_all(&d);
        let _ = std::fs::remove_dir_all(&d2);
    }
}
