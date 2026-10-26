//! 更新とこの PC の写し（決め方は program/docs/DISTRIBUTION.md）。
//! - 配る形（共有・BOX・展開したフォルダ）の exe を開くと、この PC の作業場所の app へ写し、以後はショートカットから写しで開く
//! - 使っている間に新しい版を裏で取り込み、確かめまで済ませておく（起動を待たせない）。入れ替えは次の起動の最初
//! - 起動していない間に配った版も、起動の最初に置き場を確かめて取り込むので、ショートカットから 1 回開くだけで新しい版になる
//! - 入れ替えた版が起動できなければ、控えの前の版へ戻して開く（その版には印を付け、もう取り込まない）
//!
//! この PC の作業場所（`locate::local_root()`）:
//! ```text
//! app\                    この PC のアプリ（<exe>・program・README.md）。ショートカットはここの exe（入口）を指す
//! desktop\<印>\<exe>      版ごとに写した exe。窓として動くのはこちら（動いている窓が app を掴まない）
//! update\stage\           裏で取り込み、確かめ終えた次の版（stage.json がその記録）
//! update\old\             直前の版の控え
//! update\applied.json     入れ替えた直後の印（画面が開けたら消す。開けなければ控えへ戻す）
//! update\FAILED.json      起動できなかった版（もう取り込まない）
//! update\source.json      更新の置き場（起動の最初に確かめるために控える）
//! want.json               配る版（画面が「最新版か」を出すのに使う）
//! ```
//! ここは窓に依らない処理だけ（試験から直に呼ぶ）。窓の係（裏の糸・画面への答え）は src/updater.rs。

use crate::release::{self, newer, parse_version, Release, Scan};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

/// 展開してよい大きさ（これを超える ZIP は断る）。
pub const MAX_BYTES: u64 = 1 << 30;
/// 使用中（ウイルス対策の検査・終わる途中のプロセス）で断られた名前の付け替えを待つ長さ。
const BUSY_WAIT: Duration = Duration::from_millis(3000);
const BUSY_STEP: Duration = Duration::from_millis(150);

/// 作業場所の中の置き場。
#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: &Path) -> Paths {
        Paths { root: root.to_path_buf() }
    }
    pub fn app(&self) -> PathBuf {
        self.root.join("app")
    }
    pub fn desktop(&self) -> PathBuf {
        self.root.join("desktop")
    }
    pub fn work(&self) -> PathBuf {
        self.root.join("update")
    }
    pub fn stage(&self) -> PathBuf {
        self.work().join("stage")
    }
    pub fn stage_record(&self) -> PathBuf {
        self.work().join("stage.json")
    }
    pub fn old(&self) -> PathBuf {
        self.work().join("old")
    }
    pub fn applied(&self) -> PathBuf {
        self.work().join("applied.json")
    }
    pub fn failed(&self) -> PathBuf {
        self.work().join("FAILED.json")
    }
    pub fn want(&self) -> PathBuf {
        self.root.join("want.json")
    }
    pub fn source_record(&self) -> PathBuf {
        self.work().join("source.json")
    }
}

pub fn read_json(p: &Path) -> Option<Value> {
    let b = std::fs::read(p).ok()?;
    serde_json::from_slice(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b)).ok()
}

/// JSON を書く（一時ファイル → 名前の付け替え。途中で止まっても前か後のどちらか）。
pub fn write_json(p: &Path, v: &Value) -> Result<(), String> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("{} を作れません: {e}", d.display()))?;
    }
    let tmp = p.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec_pretty(v).unwrap_or_default()).map_err(|e| format!("{} を書けません: {e}", tmp.display()))?;
    std::fs::rename(&tmp, p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{} を書けません: {e}", p.display())
    })
}

/// アプリの版（program/app/version.py の `APP_VERSION = "X.Y.Z"`）。読めなければ None。
pub fn program_version(program: &Path) -> Option<String> {
    let text = std::fs::read_to_string(program.join("app").join("version.py")).ok()?;
    text.lines().find_map(|l| {
        let rest = l.strip_prefix("APP_VERSION")?.trim_start().strip_prefix('=')?.trim();
        let q = rest.chars().next().filter(|c| *c == '\'' || *c == '"')?;
        let v = &rest[1..];
        let v = &v[..v.find(q)?];
        parse_version(v).map(|_| v.to_string())
    })
}

/// 配る形の目印（program/app/brand.json の app_id）。
fn dist_app_id(program: &Path) -> Option<String> {
    read_json(&program.join("app").join("brand.json"))?["app_id"].as_str().map(str::to_string)
}

/// 配る形（exe と program が並ぶフォルダ）を確かめる → 版。版を指定すれば一致も見る。
pub fn validate_dist(dir: &Path, exe: &str, app_id: &str, expect: Option<&str>) -> Result<String, String> {
    let program = dir.join("program");
    if !dir.join(exe).is_file() {
        return Err(format!("{exe} がありません"));
    }
    if !has_program(dir) {
        return Err(format!("{MARK} がありません"));
    }
    if dist_app_id(&program).as_deref() != Some(app_id) {
        return Err("このアプリの物ではありません（program\\app\\brand.json の app_id が違います）".into());
    }
    let v = program_version(&program).ok_or("program\\app\\version.py の版を読めません")?;
    if let Some(want) = expect {
        if v != want {
            return Err(format!("中身の版（{v}）が置き場の版（{want}）と違います"));
        }
    }
    Ok(v)
}

pub fn sha256_file(p: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    std::io::copy(&mut f, &mut h)?;
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// ZIP を dest へ展開する。絶対パス・ドライブ名・`..`・リンクの名前があれば断る。合計が MAX_BYTES を超えれば断る。
pub fn extract_zip(zip: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip).map_err(|e| format!("ZIP を開けません: {e}"))?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| format!("ZIP として読めません: {e}"))?;
    let mut total = 0u64;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|e| format!("ZIP の中を読めません: {e}"))?;
        let name = e.name().map_err(|e| format!("ZIP の中の名前を読めません: {e}"))?.to_string();
        let rel = Path::new(&name);
        let bad = name.contains(':')
            || name.starts_with(['/', '\\'])
            || rel.components().any(|c| !matches!(c, Component::Normal(_)))
            || e.is_symlink()
            || name.split(['/', '\\']).any(|p| p == "..");
        if bad {
            return Err(format!("ZIP に危ない名前があります: {name}"));
        }
        total = total.saturating_add(e.size());
        if total > MAX_BYTES {
            return Err("ZIP の中身が 1 GB を超えます".into());
        }
        let out = dest.join(rel);
        if e.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(d) = out.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        let mut w = std::fs::File::create(&out).map_err(|e| format!("{} を書けません: {e}", out.display()))?;
        // 名乗った大きさより多くは読まない（ZIP が名乗る大きさで数えているので、実際の展開が名乗りを超えたら断る）
        let said = e.size();
        let mut buf = Vec::new();
        (&mut e).take(said.saturating_add(1)).read_to_end(&mut buf).map_err(|e| format!("ZIP の中を読めません（{name}）: {e}"))?;
        if buf.len() as u64 > said {
            return Err(format!("ZIP の中身が名乗った大きさを超えます: {name}"));
        }
        std::io::Write::write_all(&mut w, &buf).map_err(|e| e.to_string())?;
        // 実行の許可を戻す（Linux などの試験の窓。Windows には無い考え）
        #[cfg(unix)]
        if let Some(mode) = e.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode & 0o777));
        }
    }
    Ok(())
}

/// 配る形の目印（画面の入口）。exe と並ぶ program の中にある。
pub const MARK: &str = "program\\app\\static\\index.html";

/// dir が配る形か（exe と program が並び、program に画面がある）。
pub fn has_program(dir: &Path) -> bool {
    dir.join("program").join("app").join("static").join("index.html").is_file()
}

/// 展開したフォルダの中の配る形の根（program の画面がある所。先頭のフォルダ名には頼らない）。
pub fn dist_root(dir: &Path) -> Option<PathBuf> {
    if has_program(dir) {
        return Some(dir.to_path_buf());
    }
    let subs: Vec<PathBuf> = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    match subs.as_slice() {
        [one] if has_program(one) => Some(one.clone()),
        _ => None,
    }
}

/// 起動できなかった版。
pub fn failed_versions(p: &Paths) -> Vec<String> {
    read_json(&p.failed())
        .and_then(|v| v["versions"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|x| x.as_str().map(str::to_string))
        .collect()
}

pub fn mark_failed(p: &Paths, version: &str) {
    let mut vs = failed_versions(p);
    if !vs.iter().any(|v| v == version) {
        vs.push(version.to_string());
    }
    let _ = write_json(&p.failed(), &json!({ "versions": vs }));
}

/// 取り込み済みの次の版（stage.json の中身）。版のフォルダが無ければ None。
pub fn staged(p: &Paths) -> Option<Value> {
    let v = read_json(&p.stage_record())?;
    has_program(&p.stage()).then_some(v)
}

/// 置き場の版を裏で取り込む: 手元へ写す → 指紋を照らす → 展開 → 中身を確かめる → update\stage へ（前の取り込みは捨てる）。
/// 動いているアプリには触らない（入れ替えは次の起動の最初・apply_staged）。
pub fn stage_release(p: &Paths, rel: &Release, app_id: &str, progress: &dyn Fn(&str)) -> Result<Value, String> {
    let work = p.work();
    std::fs::create_dir_all(&work).map_err(|e| format!("{} を作れません: {e}", work.display()))?;
    let pid = std::process::id();
    let (dl, tmp) = (work.join(format!("dl-{pid}.zip")), work.join(format!("stage-tmp-{pid}")));
    let clean = || {
        let _ = std::fs::remove_file(&dl);
        let _ = std::fs::remove_dir_all(&tmp);
    };
    clean();
    let result = (|| {
        progress(&format!("版 {} を写しています", rel.version));
        std::fs::copy(rel.zip_path(), &dl).map_err(|e| format!("置き場の ZIP を写せません（{}）: {e}", rel.zip_path().display()))?;
        progress(&format!("版 {} の指紋を確かめています", rel.version));
        let sum = sha256_file(&dl).map_err(|e| e.to_string())?;
        if sum != rel.sha256 {
            return Err(format!("ZIP の指紋が release.json と違います（置いている途中か、壊れています）: {}", rel.zip));
        }
        extract_zip(&dl, &tmp)?;
        let root = dist_root(&tmp).ok_or_else(|| format!("ZIP に {MARK} がありません"))?;
        validate_dist(&root, &rel.exe, app_id, Some(&rel.version))?;
        let _ = std::fs::remove_dir_all(p.stage());
        let _ = std::fs::remove_file(p.stage_record());
        std::fs::rename(&root, p.stage()).map_err(|e| format!("取り込んだ版を置けません: {e}"))?;
        let rec = json!({"version": rel.version, "exe": rel.exe, "sha256": rel.sha256, "from": rel.zip_path(),
                         "at": now_text()});
        write_json(&p.stage_record(), &rec)?;
        Ok(rec)
    })();
    clean();
    result
}

/// 名前の付け替え。「使用中」（Windows の 5・32・33）だけは BUSY_WAIT まで待ってやり直す。
pub fn rename_patiently(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut waited = Duration::ZERO;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if matches!(e.raw_os_error(), Some(5 | 32 | 33)) && waited < BUSY_WAIT => {
                std::thread::sleep(BUSY_STEP);
                waited += BUSY_STEP;
            }
            Err(e) => return Err(e),
        }
    }
}

/// フォルダ new を app に据える（今の app は old へ。途中で失敗したら戻す）。
fn swap_in(p: &Paths, new: &Path) -> Result<(), String> {
    let (app, old) = (p.app(), p.old());
    let _ = std::fs::remove_dir_all(&old);
    let had = app.exists();
    if had {
        rename_patiently(&app, &old).map_err(|e| format!("この PC のアプリを入れ替えられません（使用中）: {e}"))?;
    }
    if let Err(e) = rename_patiently(new, &app) {
        if had {
            let _ = std::fs::rename(&old, &app);
        }
        return Err(format!("新しい版を置けません: {e}"));
    }
    Ok(())
}

/// 入れ替えた結果。
#[derive(Debug, PartialEq)]
pub struct Applied {
    pub from: String,
    pub to: String,
    /// exe も変わったか（変わったら新しい exe で開き直す）
    pub exe_changed: bool,
}

fn exe_sum(dir: &Path, exe: &str) -> Option<String> {
    sha256_file(&dir.join(exe)).ok()
}

/// 起動の最初（画面を開く前）: 取り込み済みの版があれば app と入れ替える。起動できなかった版・同じ版は入れ替えない。
pub fn apply_staged(p: &Paths, exe: &str) -> Result<Option<Applied>, String> {
    let Some(rec) = staged(p) else { return Ok(None) };
    let to = rec["version"].as_str().unwrap_or("").to_string();
    let from = program_version(&p.app().join("program")).unwrap_or_default();
    if to.is_empty() || to == from || failed_versions(p).contains(&to) {
        let _ = std::fs::remove_dir_all(p.stage());
        let _ = std::fs::remove_file(p.stage_record());
        return Ok(None);
    }
    let before = exe_sum(&p.app(), exe);
    swap_in(p, &p.stage())?;
    let _ = std::fs::remove_file(p.stage_record());
    write_json(&p.applied(), &json!({"from": from, "to": to, "at": now_text()}))?;
    Ok(Some(Applied { exe_changed: exe_sum(&p.app(), exe) != before, from, to }))
}

/// 入れ替えた版が起動できなかった: その版に印を付け、控え（直前の版）へ戻す。→ 戻した版（戻せなければ None）。
pub fn revert(p: &Paths) -> Option<Applied> {
    let rec = read_json(&p.applied())?;
    let (from, to) = (rec["from"].as_str().unwrap_or("").to_string(), rec["to"].as_str().unwrap_or("").to_string());
    mark_failed(p, &to);
    let _ = std::fs::remove_file(p.applied());
    if !has_program(&p.old()) {
        return None;
    }
    let broken = p.work().join(format!("broken-{}", std::process::id()));
    rename_patiently(&p.app(), &broken).ok()?;
    if rename_patiently(&p.old(), &p.app()).is_err() {
        let _ = std::fs::rename(&broken, p.app());
        return None;
    }
    let _ = std::fs::remove_dir_all(&broken);
    Some(Applied { from: to, to: from, exe_changed: true })
}

/// 画面が開けた: 入れ替えた直後の印を消す（控えは次の入れ替えまで残す）。
pub fn confirm(p: &Paths) {
    let _ = std::fs::remove_file(p.applied());
}

/// 置き場を探した結果から、取り込む版を決める（裏の確かめと起動の最初で同じ決め方）。
#[derive(Debug, PartialEq)]
pub enum Pick<'a> {
    /// 取り込む版が無い（理由。いまの版が最新なら None）
    Stay(Option<String>),
    /// この版を取り込む（向き: up＝新しい版へ・down＝配る版を前の版に戻した）
    Take(&'a Release, &'static str),
}

/// 配る版が決まっていればその版（前の版へ戻すときも）、決まっていなければいちばん新しい版。起動できなかった版は選ばない。
pub fn pick<'a>(scan: &'a Scan, failed: &[String], current: &str) -> Pick<'a> {
    let target = match &scan.distribute {
        Some(d) => scan.find(&d.version).filter(|r| !failed.contains(&r.version)),
        None => scan.by_version().into_iter().find(|r| !failed.contains(&r.version)),
    };
    let Some(target) = target else {
        return Pick::Stay(Some(match &scan.distribute {
            Some(d) if failed.contains(&d.version) => format!("配る版 {} はこの PC で起動できなかったので使いません", d.version),
            Some(d) => format!("配る版 {} がまだ置き場にありません（BOX の同期待ちかもしれません）", d.version),
            None => "置き場にこのアプリの版がありません".into(),
        }));
    };
    if target.version == current || (scan.distribute.is_none() && !newer(&target.version, current)) {
        return Pick::Stay(None);
    }
    Pick::Take(target, if newer(&target.version, current) { "up" } else { "down" })
}

/// 更新の置き場を控える（裏の確かめが設定から読んだ物。空なら控えを消す＝起動の最初には確かめない）。
pub fn remember_source(p: &Paths, source: &str) {
    if source.trim().is_empty() {
        let _ = std::fs::remove_file(p.source_record());
    } else if remembered_source(p).as_deref() != Some(source) {
        let _ = write_json(&p.source_record(), &json!({"source": source, "at": now_text()}));
    }
}

/// 控えた更新の置き場（無ければ None）。
pub fn remembered_source(p: &Paths) -> Option<String> {
    read_json(&p.source_record())?["source"].as_str().map(str::to_string).filter(|s| !s.trim().is_empty())
}

/// 起動の最初に確かめた結果。
#[derive(Debug, PartialEq)]
pub enum Launch {
    /// 確かめなかった・取り込む版が無い（理由）
    Nothing(String),
    /// 置き場に届くのに時間が掛かるので待たなかった（裏の確かめに任せる）
    Slow,
    /// 取り込んだ（または取り込み済みだった）版。このあと apply_staged が入れ替える
    Staged(String),
    /// 取り込めなかった（理由。いまの版のまま開く）
    Failed(String),
}

/// 起動の最初（画面を開く前）: 置き場（source。区切りの候補つき）を探し、取り込む版があれば取り込む。
/// 置き場を探すのは別の糸で、wait を過ぎたら待たない（届かない共有で起動を待たせない）。取り込みは進み具合を progress に言いながら待つ。
/// 配る版を作業場所に覚える（want.json。裏の確かめと同じ）。
pub fn launch_check(p: &Paths, source: &str, app_id: &str, current: &str, wait: Duration, progress: &dyn Fn(&str)) -> Launch {
    if source.trim().is_empty() {
        return Launch::Nothing("更新の置き場を控えていません".into());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let (src, id) = (source.to_string(), app_id.to_string());
    std::thread::spawn(move || {
        let _ = tx.send(release::locate_source(&src).map(|(found, _)| release::scan(&found, &id)));
    });
    let scan = match rx.recv_timeout(wait) {
        Ok(Ok(scan)) => scan,
        Ok(Err(e)) => return Launch::Nothing(e),
        Err(_) => return Launch::Slow,
    };
    match &scan.distribute {
        Some(d) => {
            let _ = write_json(&p.want(), &d.raw);
        }
        None => {
            let _ = std::fs::remove_file(p.want());
        }
    }
    match pick(&scan, &failed_versions(p), current) {
        Pick::Stay(why) => Launch::Nothing(why.unwrap_or_else(|| format!("版 {current} が最新です"))),
        Pick::Take(rel, _) if staged(p).is_some_and(|s| s["version"] == json!(rel.version)) => Launch::Staged(rel.version.clone()),
        Pick::Take(rel, _) => match stage_release(p, rel, app_id, progress) {
            Ok(_) => Launch::Staged(rel.version.clone()),
            Err(e) => Launch::Failed(format!("版 {} を取り込めません: {e}", rel.version)),
        },
    }
}

/// 写した exe から「インターネットから来た」印（Zone.Identifier）を外す（開くたびの実行前の警告を出さない・設計書 §14.3）。
/// Windows の写し方は印も写すので、出どころの分かっている自分で写した物だけ外す。ほかの OS には印が無い。
pub fn drop_web_mark(path: &Path) {
    if cfg!(windows) {
        let mut s = path.as_os_str().to_os_string();
        s.push(":Zone.Identifier");
        let _ = std::fs::remove_file(PathBuf::from(s));
    }
}

/// 配る形（共有・BOX・展開したフォルダ）をこの PC の app へ写す。.pyc・__pycache__ は写さない。
pub fn localize(p: &Paths, dist: &Path, exe: &str, app_id: &str) -> Result<String, String> {
    let version = validate_dist(dist, exe, app_id, None)?;
    std::fs::create_dir_all(p.work()).map_err(|e| e.to_string())?;
    let tmp = p.work().join(format!("local-tmp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let copy = (|| {
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        std::fs::copy(dist.join(exe), tmp.join(exe)).map_err(|e| format!("{exe} を写せません: {e}"))?;
        drop_web_mark(&tmp.join(exe));
        copy_tree(&dist.join("program"), &tmp.join("program"))?;
        if dist.join("README.md").is_file() {
            let _ = std::fs::copy(dist.join("README.md"), tmp.join("README.md"));
        }
        validate_dist(&tmp, exe, app_id, Some(&version))?;
        swap_in(p, &tmp)
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    copy.map(|_| version)
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for e in std::fs::read_dir(from).map_err(|e| format!("{} を読めません: {e}", from.display()))?.flatten() {
        let (name, path) = (e.file_name(), e.path());
        let n = name.to_string_lossy();
        if n == "__pycache__" || n.ends_with(".pyc") {
            continue;
        }
        if path.is_dir() {
            copy_tree(&path, &to.join(&name))?;
        } else {
            std::fs::copy(&path, to.join(&name)).map_err(|e| format!("{} を写せません: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// app を写すべきか: まだ無い・この配る形の方が新しい（古い共有の exe を開いても戻さない）。
pub fn should_localize(p: &Paths, dist_version: &str) -> bool {
    match program_version(&p.app().join("program")) {
        None => true,
        Some(have) => newer(dist_version, &have) && !failed_versions(p).iter().any(|v| v == dist_version),
    }
}

/// 起動のはじめに何をするか。
#[derive(Debug, PartialEq)]
pub enum Step {
    /// このまま窓として動く（版ごとの写し・開発の作業ツリー）
    Stay,
    /// app の exe（入口）: 版ごとの写しへ渡して終わる
    Handoff,
    /// app の外（共有・BOX・展開したフォルダ）の配る形: この PC の app へ写して（新しければ）から入口を開く
    Localize(PathBuf),
}

fn same(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// 決める（純粋な判断・試験が直に確かめる）。me＝いま動いている exe、dev＝開発の作業ツリー・引き継がない指定。
pub fn plan(p: &Paths, me: &Path, exe: &str, dev: bool) -> Step {
    if dev {
        return Step::Stay;
    }
    if me.starts_with(p.desktop())
        || std::fs::canonicalize(me).is_ok_and(|m| std::fs::canonicalize(p.desktop()).is_ok_and(|d| m.starts_with(d)))
    {
        return Step::Stay;
    }
    // app の exe（入口）。前の名前の exe（名前の歴史: 前の版の窓は入れ替えたあと前の名前で開き直す・前の名前のピン留め）も入口
    if same(me, &p.app().join(exe)) || me.parent().is_some_and(|d| same(d, &p.app())) {
        return Step::Handoff;
    }
    match me.parent() {
        Some(dir) if has_program(dir) => Step::Localize(dir.to_path_buf()),
        _ => Step::Stay,
    }
}

/// 版ごとの写しの置き場（exe の大きさ＋更新時刻。中身が変われば別の場所）。
pub fn copy_for_run(p: &Paths, app_exe: &Path) -> Result<PathBuf, String> {
    let m = std::fs::metadata(app_exe).map_err(|e| format!("{} を読めません: {e}", app_exe.display()))?;
    let t = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let dir = p.desktop().join(format!("{}-{t}", m.len()));
    let dest = dir.join(app_exe.file_name().unwrap_or_default());
    if dest.is_file() && std::fs::metadata(&dest).map(|d| d.len()).ok() == Some(m.len()) {
        return Ok(dest);
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
    let tmp = dir.join(format!(".copy-{}", std::process::id()));
    std::fs::copy(app_exe, &tmp).map_err(|e| format!("exe を写せません: {e}"))?;
    drop_web_mark(&tmp);
    std::fs::rename(&tmp, &dest).map_err(|e| format!("exe を置けません: {e}"))?;
    Ok(dest)
}

/// 古い版ごとの写しを片付ける（動いている版は消せないので、消せた物だけ）。
pub fn cleanup_copies(p: &Paths, keep: &Path) {
    for e in std::fs::read_dir(p.desktop()).into_iter().flatten().flatten() {
        let path = e.path();
        if path.is_dir() && !keep.starts_with(&path) {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

fn now_text() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const EXE: &str = "App.exe";
    const ID: &str = "local.test.app";

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("da-upd-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// 配る形を作る（exe・program の画面・brand.json・version.py）。
    pub fn dist(dir: &Path, version: &str, exe_body: &str) {
        let app = dir.join("program").join("app");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(dir.join(EXE), exe_body).unwrap();
        std::fs::create_dir_all(app.join("static")).unwrap();
        std::fs::write(app.join("static").join("index.html"), "<!doctype html>").unwrap();
        std::fs::write(app.join("brand.json"), format!(r#"{{"app_id":"{ID}"}}"#)).unwrap();
        std::fs::write(app.join("version.py"), format!("APP_VERSION = \"{version}\"\n")).unwrap();
    }

    fn zip_of(dir: &Path, top: &str, out: &Path) -> String {
        let f = std::fs::File::create(out).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let opt = zip::write::SimpleFileOptions::default();
        for e in walk(dir) {
            let rel = e.strip_prefix(dir).unwrap().to_string_lossy().replace('\\', "/");
            z.start_file(format!("{top}/{rel}"), opt).unwrap();
            z.write_all(&std::fs::read(&e).unwrap()).unwrap();
        }
        z.finish().unwrap();
        sha256_file(out).unwrap()
    }

    fn walk(d: &Path) -> Vec<PathBuf> {
        let mut out = vec![];
        for e in std::fs::read_dir(d).unwrap().flatten() {
            if e.path().is_dir() {
                out.extend(walk(&e.path()));
            } else {
                out.push(e.path());
            }
        }
        out
    }

    fn release(dir: &Path, version: &str, sha: &str) -> Release {
        Release {
            dir: dir.to_path_buf(),
            name: "App".into(),
            version: version.into(),
            zip: "App.zip".into(),
            sha256: sha.into(),
            exe: EXE.into(),
            raw: Value::Null,
        }
    }

    #[test]
    fn version_py_is_read() {
        let d = tmp("ver");
        dist(&d, "3.9.0", "x");
        assert_eq!(program_version(&d.join("program")).as_deref(), Some("3.9.0"));
        assert_eq!(validate_dist(&d, EXE, ID, Some("3.9.0")), Ok("3.9.0".into()));
        assert!(validate_dist(&d, EXE, "other", None).is_err(), "ほかのアプリは断る");
        assert!(validate_dist(&d, EXE, ID, Some("3.9.1")).unwrap_err().contains("違います"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn stage_then_apply_then_revert() {
        let d = tmp("flow");
        let p = Paths::new(&d.join("local"));
        // この PC の app は 3.9.0
        dist(&d.join("share"), "3.9.0", "exe-1");
        assert!(should_localize(&p, "3.9.0"));
        assert_eq!(localize(&p, &d.join("share"), EXE, ID), Ok("3.9.0".into()));
        assert!(!should_localize(&p, "3.9.0") && !should_localize(&p, "3.8.0"), "同じ版・古い共有の exe では写さない");
        // 置き場に 3.10.0（exe も変わる）
        dist(&d.join("new"), "3.10.0", "exe-2");
        let rel_dir = d.join("rel");
        std::fs::create_dir_all(&rel_dir).unwrap();
        let sha = zip_of(&d.join("new"), "App", &rel_dir.join("App.zip"));
        let rec = stage_release(&p, &release(&rel_dir, "3.10.0", &sha), ID, &|_| {}).unwrap();
        assert_eq!(rec["version"], "3.10.0");
        assert_eq!(program_version(&p.app().join("program")).as_deref(), Some("3.9.0"), "取り込んでも動いている app には触らない");
        // 次の起動: 入れ替える
        let a = apply_staged(&p, EXE).unwrap().unwrap();
        assert_eq!((a.from.as_str(), a.to.as_str(), a.exe_changed), ("3.9.0", "3.10.0", true));
        assert_eq!(program_version(&p.app().join("program")).as_deref(), Some("3.10.0"));
        assert_eq!(program_version(&p.old().join("program")).as_deref(), Some("3.9.0"), "直前の版は控えに");
        // 新しい版が起動できなかった → 控えへ戻し、もう取り込まない
        let back = revert(&p).unwrap();
        assert_eq!((back.from.as_str(), back.to.as_str()), ("3.10.0", "3.9.0"));
        assert_eq!(program_version(&p.app().join("program")).as_deref(), Some("3.9.0"));
        assert_eq!(failed_versions(&p), ["3.10.0"]);
        stage_release(&p, &release(&rel_dir, "3.10.0", &sha), ID, &|_| {}).unwrap();
        assert_eq!(apply_staged(&p, EXE).unwrap(), None, "起動できなかった版へは入れ替えない");
        assert!(!should_localize(&p, "3.10.0"), "起動できなかった版を共有から写し直さない");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn staging_refuses_bad_zips_and_leaves_nothing() {
        let d = tmp("bad");
        let p = Paths::new(&d.join("local"));
        dist(&d.join("new"), "3.10.0", "x");
        let rel_dir = d.join("rel");
        std::fs::create_dir_all(&rel_dir).unwrap();
        let sha = zip_of(&d.join("new"), "App", &rel_dir.join("App.zip"));
        let bad_sha = "0".repeat(64);
        assert!(stage_release(&p, &release(&rel_dir, "3.10.0", &bad_sha), ID, &|_| {}).unwrap_err().contains("指紋"));
        assert!(stage_release(&p, &release(&rel_dir, "3.11.0", &sha), ID, &|_| {}).unwrap_err().contains("版"));
        // 危ない名前
        let evil = rel_dir.join("evil.zip");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&evil).unwrap());
            z.start_file("../outside.txt", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b"x").unwrap();
            z.finish().unwrap();
        }
        let mut r = release(&rel_dir, "3.10.0", &sha256_file(&evil).unwrap());
        r.zip = "evil.zip".into();
        assert!(stage_release(&p, &r, ID, &|_| {}).unwrap_err().contains("危ない"));
        assert!(!d.join("outside.txt").exists() && !d.join("local").join("outside.txt").exists(), "外に書かない");
        let left: Vec<_> = std::fs::read_dir(p.work()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert!(left.is_empty(), "途中の物を残さない: {left:?}");
        assert!(staged(&p).is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// 置き場（rel/App/<版>/）に版を置く（release.json と ZIP）
    fn put_release(d: &Path, rel: &Path, version: &str) {
        let src = d.join(format!("src-{version}"));
        dist(&src, version, &format!("exe-{version}"));
        let dir = rel.join("App").join(version);
        std::fs::create_dir_all(&dir).unwrap();
        let sha = zip_of(&src, "App", &dir.join("App.zip"));
        let v = json!({"schema": 1, "app_id": ID, "name": "App", "version": version, "zip": "App.zip", "sha256": sha, "exe": EXE});
        std::fs::write(dir.join(crate::release::MARKER), serde_json::to_vec(&v).unwrap()).unwrap();
    }

    #[test]
    fn launch_check_stages_a_version_distributed_while_closed() {
        // 要望（2026-10）: 起動していない間に配った版を、ショートカットから 1 回開くだけで入れる
        let d = tmp("launch");
        let p = Paths::new(&d.join("local"));
        dist(&d.join("share"), "3.9.0", "exe-3.9.0");
        localize(&p, &d.join("share"), EXE, ID).unwrap();
        let rel = d.join("Releases");
        put_release(&d, &rel, "3.9.0");
        let src = rel.display().to_string();
        let wait = Duration::from_secs(10);
        assert_eq!(launch_check(&p, "", ID, "3.9.0", wait, &|_| {}), Launch::Nothing("更新の置き場を控えていません".into()));
        assert!(matches!(launch_check(&p, &src, ID, "3.9.0", wait, &|_| {}), Launch::Nothing(_)), "いまの版が最新なら取り込まない");
        // 閉じている間に 3.10.0 を置いた → 起動の最初に取り込み、入れ替える（1 回の起動）
        put_release(&d, &rel, "3.10.0");
        let said = std::cell::RefCell::new(vec![]);
        assert_eq!(launch_check(&p, &src, ID, "3.9.0", wait, &|t| said.borrow_mut().push(t.to_string())), Launch::Staged("3.10.0".into()));
        assert!(!said.borrow().is_empty(), "取り込みの進み具合を起動画面へ言う");
        assert_eq!(apply_staged(&p, EXE).unwrap().map(|a| a.to), Some("3.10.0".into()));
        // 配る版を前の版に戻した → 戻す向きでも 1 回の起動で入る。配る版を覚える
        std::fs::write(
            rel.join("App").join(crate::release::DISTRIBUTE),
            serde_json::to_vec(&json!({"schema": 1, "app_id": ID, "version": "3.9.0", "setAt": "2026-10-16T10:00:00"})).unwrap(),
        )
        .unwrap();
        assert_eq!(launch_check(&p, &src, ID, "3.10.0", wait, &|_| {}), Launch::Staged("3.9.0".into()));
        assert_eq!(read_json(&p.want()).unwrap()["version"], "3.9.0", "配る版を作業場所に覚える");
        // 起動できなかった版は取り込まない
        mark_failed(&p, "3.9.0");
        assert!(matches!(launch_check(&p, &src, ID, "3.10.0", wait, &|_| {}), Launch::Nothing(w) if w.contains("起動できなかった")));
        // 届かない置き場は理由を言うだけ（いまの版で開く）
        assert!(matches!(launch_check(&p, &d.join("無い").display().to_string(), ID, "3.10.0", wait, &|_| {}), Launch::Nothing(_)));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn launch_check_does_not_wait_for_a_slow_place() {
        // 置き場を探すのが待つ長さを過ぎたら、待たずに開く（裏の確かめに任せる）
        let d = tmp("slow");
        let p = Paths::new(&d.join("local"));
        let t0 = std::time::Instant::now();
        let r = launch_check(&p, &d.display().to_string(), ID, "3.9.0", Duration::ZERO, &|_| {});
        assert!(matches!(r, Launch::Slow | Launch::Nothing(_)), "{r:?}");
        assert!(t0.elapsed() < Duration::from_secs(2));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_source_is_remembered_for_the_next_launch() {
        let d = tmp("source");
        let p = Paths::new(&d.join("local"));
        assert_eq!(remembered_source(&p), None);
        remember_source(&p, "C:\\Box\\DefectTrace;D:\\rel");
        assert_eq!(remembered_source(&p).as_deref(), Some("C:\\Box\\DefectTrace;D:\\rel"));
        remember_source(&p, " ");
        assert_eq!(remembered_source(&p), None, "置き場を外したら、起動の最初にも確かめない");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn pick_follows_the_distributed_version_and_skips_failed_ones() {
        let r = |v: &str| release(Path::new("x"), v, "s");
        let scan = Scan { versions: vec![r("3.9.0"), r("3.11.0"), r("3.10.0")], distribute: None, problems: vec![] };
        assert!(matches!(pick(&scan, &[], "3.9.0"), Pick::Take(x, "up") if x.version == "3.11.0"), "配る版が無ければいちばん新しい版");
        assert!(
            matches!(pick(&scan, &["3.11.0".into()], "3.9.0"), Pick::Take(x, "up") if x.version == "3.10.0"),
            "起動できなかった版は飛ばす"
        );
        assert_eq!(pick(&scan, &[], "3.11.0"), Pick::Stay(None));
        assert_eq!(pick(&scan, &[], "3.12.0"), Pick::Stay(None), "配る版が無ければ古い版へは戻さない");
        let down = Scan {
            distribute: Some(crate::release::Distribute { dir: "x".into(), version: "3.10.0".into(), raw: Value::Null }),
            ..scan.clone()
        };
        assert!(matches!(pick(&down, &[], "3.11.0"), Pick::Take(x, "down") if x.version == "3.10.0"), "配る版へは戻す向きでも");
        let missing =
            Scan { distribute: Some(crate::release::Distribute { dir: "x".into(), version: "3.12.0".into(), raw: Value::Null }), ..scan };
        assert!(matches!(pick(&missing, &[], "3.11.0"), Pick::Stay(Some(w)) if w.contains("まだ置き場にありません")));
    }

    #[test]
    fn plan_of_the_start() {
        let d = tmp("plan");
        let p = Paths::new(&d.join("local"));
        dist(&d.join("share"), "3.9.0", "x");
        localize(&p, &d.join("share"), EXE, ID).unwrap();
        assert_eq!(plan(&p, &d.join("share").join(EXE), EXE, false), Step::Localize(d.join("share")), "共有の exe はこの PC へ写す");
        assert_eq!(plan(&p, &p.app().join(EXE), EXE, false), Step::Handoff, "入口は版ごとの写しへ渡す");
        std::fs::write(p.app().join("Old.exe"), "x").unwrap();
        assert_eq!(plan(&p, &p.app().join("Old.exe"), EXE, false), Step::Handoff, "app の前の名前の exe も入口（写し直さない）");
        let copy = copy_for_run(&p, &p.app().join(EXE)).unwrap();
        assert!(copy.starts_with(p.desktop()));
        assert_eq!(copy_for_run(&p, &p.app().join(EXE)).unwrap(), copy, "同じ exe なら写し直さない");
        assert_eq!(plan(&p, &copy, EXE, false), Step::Stay, "版ごとの写しは窓として動く");
        assert_eq!(plan(&p, &d.join("share").join(EXE), EXE, true), Step::Stay, "開発の作業ツリーは引き継がない");
        assert_eq!(plan(&p, &d.join("nowhere").join(EXE), EXE, false), Step::Stay);
        std::fs::create_dir_all(p.desktop().join("old-1")).unwrap();
        cleanup_copies(&p, &copy);
        assert!(copy.is_file() && !p.desktop().join("old-1").exists(), "古い写しは片付け、動いている写しは残す");
        let _ = std::fs::remove_dir_all(&d);
    }
}
