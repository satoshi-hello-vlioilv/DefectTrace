//! 配布: 画面から版を置く・配る版を選ぶ・推奨の札・配る入口を置く、と、配る入口から新しい PC へ（program/docs/DISTRIBUTION.md）。
//! 置いてよいのはだれかは設定（config.json の release_users。空ならだれでも）で決める（updater.rs）。ここは置き場の形だけを扱う。
//!
//! 置き場（release.rs と同じ形）:
//! ```text
//! <更新の置き場>\<アプリのフォルダ>\
//!   distribute.json          { schema:1, app_id, version, entry, aliases, setAt, setBy, setPc, previous, recommended? }
//!                            recommended: { note, setAt, setBy, setPc } = 推奨アップデートの札。各 PC は、配る版に札が付いていて
//!                            まだその版でなければ、開き直しを促す知らせを出す。配る版を選び直すと外れる（版ごとの決め）
//!   <exe>                    配る入口（配る版の ZIP の exe。新しい PC へはこのアドレスだけを渡す）
//!   <版>\release.json        { schema:1, app_id, name, version, zip, sha256, exe, placedAt, placedBy, placedPc, source }
//!   <版>\<name>-<版>-windows.zip
//! ```
//! 置くときは `.<版>.placing-<pid>` へ写して指紋を確かめ直し、release.json を書いてから名前を変える（各 PC が置きかけを読まない）。
//! 消すときは逆に、先に `.<版>.removing-<pid>` へ名前を変えてから中身を消す（各 PC が消しかけを読まない）。

use crate::release::{self, Release, Scan, DISTRIBUTE, MARKER};
use crate::update::{self, dist_root, extract_zip, read_json, sha256_file, validate_dist, write_json, Paths};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// だれが（Windows のログイン名と PC の名前）。
#[derive(Debug, Clone, Default)]
pub struct Who {
    pub login: String,
    pub pc: String,
}

/// 進み具合を伝える（段・済んだバイト・全部のバイト）。
pub type Progress<'a> = &'a dyn Fn(&str, u64, u64);

fn now_text() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// アプリのフォルダ（配る版の覚えがあればそこ、無ければいちばん新しい版の隣、どちらも無ければ 置き場\<アプリ名>）。
pub fn app_folder(found: &Path, scan: &Scan, name: &str) -> PathBuf {
    if let Some(d) = &scan.distribute {
        return d.dir.clone();
    }
    if let Some(r) = scan.newest() {
        if let Some(parent) = r.dir.parent() {
            return parent.to_path_buf();
        }
    }
    found.join(name)
}

/// 配る形の名乗り（ZIP の中の program/app/brand.json）。
fn dist_brand(root: &Path) -> Result<Value, String> {
    read_json(&root.join("program").join("app").join("brand.json")).ok_or_else(|| "ZIP に program\\app\\brand.json がありません".into())
}

/// 写しながら進み具合を伝える。
fn copy_with_progress(from: &Path, to: &Path, progress: Progress) -> Result<u64, String> {
    let total = std::fs::metadata(from).map(|m| m.len()).unwrap_or(0);
    let mut r = std::fs::File::open(from).map_err(|e| format!("{} を開けません: {e}", from.display()))?;
    let mut w = std::fs::File::create(to).map_err(|e| format!("{} を書けません: {e}", to.display()))?;
    let (mut buf, mut done) = (vec![0u8; 1 << 20], 0u64);
    loop {
        let n = r.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        w.write_all(&buf[..n]).map_err(|e| format!("置き場へ書けません: {e}"))?;
        done += n as u64;
        progress("copy", done, total);
    }
    w.sync_all().map_err(|e| e.to_string())?;
    Ok(done)
}

/// 画面から選んだ ZIP を置き場に置く。→ 置いた版の release.json
pub fn place(p: &Paths, found: &Path, zip: &Path, source_name: &str, app_id: &str, who: &Who, progress: Progress) -> Result<Value, String> {
    progress("check", 0, 0);
    let work = p.work();
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let tmp = work.join(format!("place-check-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let checked = (|| {
        extract_zip(zip, &tmp)?;
        let root = dist_root(&tmp).ok_or_else(|| format!("ZIP に {} がありません（配る ZIP ではありません）", update::MARK))?;
        let b = dist_brand(&root)?;
        if b["app_id"].as_str() != Some(app_id) {
            return Err("このアプリの ZIP ではありません（目印 app_id が違います）".to_string());
        }
        let exe = b["exe"].as_str().unwrap_or("").to_string();
        let name = b["name"].as_str().unwrap_or("").to_string();
        if !release::safe_name(&exe) || name.is_empty() {
            return Err("ZIP の名前の定義（brand.json の name・exe）が正しくありません".to_string());
        }
        let version = validate_dist(&root, &exe, app_id, None)?;
        Ok((version, exe, name))
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    let (version, exe, name) = checked?;
    let scan = release::scan(found, app_id);
    if scan.find(&version).is_some() {
        return Err(format!("版 {version} はもう置いてあります（同じ版は置けません。取り込んだ PC と中身が食い違うため）"));
    }
    let folder = app_folder(found, &scan, &name);
    let (dest, placing) = (folder.join(&version), folder.join(format!(".{version}.placing-{}", std::process::id())));
    if dest.exists() {
        return Err(format!("{} がもうあります", dest.display()));
    }
    let _ = std::fs::remove_dir_all(&placing);
    let result = (|| {
        std::fs::create_dir_all(&placing).map_err(|e| format!("置き場にフォルダを作れません（{}）: {e}", placing.display()))?;
        let zip_name = format!("{name}-{version}-windows.zip");
        let sha = sha256_file(zip).map_err(|e| e.to_string())?;
        copy_with_progress(zip, &placing.join(&zip_name), progress)?;
        progress("finish", 0, 0);
        if sha256_file(&placing.join(&zip_name)).map_err(|e| e.to_string())? != sha {
            return Err("置き場へ写した ZIP の指紋が元と違います（写す途中で壊れました）".to_string());
        }
        let rel = json!({"schema": 1, "app_id": app_id, "name": name, "version": version, "zip": zip_name, "sha256": sha, "exe": exe,
                         "placedAt": now_text(), "placedBy": who.login, "placedPc": who.pc, "source": source_name,
                         "bytes": std::fs::metadata(zip).map(|m| m.len()).unwrap_or(0)});
        write_json(&placing.join(MARKER), &rel)?;
        std::fs::rename(&placing, &dest).map_err(|e| format!("版のフォルダを置けません: {e}"))?;
        Ok(rel)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&placing);
    }
    result
}

/// ZIP の中から配る形の exe を取り出す（配る入口にする）。
fn extract_exe(zip: &Path, exe: &str, to: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let names: Vec<String> = z.file_names().map(|n| n.map(|n| n.into_owned()).map_err(|e| e.to_string())).collect::<Result<_, _>>()?;
    // 配る形の根（program/app/static/index.html の program の隣）の exe
    let root = names
        .iter()
        .find_map(|n| n.strip_suffix("program/app/static/index.html"))
        .ok_or("ZIP に program/app/static/index.html がありません")?
        .to_string();
    let mut e = z.by_name(&format!("{root}{exe}")).map_err(|_| format!("ZIP に {exe} がありません"))?;
    let mut buf = Vec::new();
    e.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    std::fs::write(to, buf).map_err(|e| format!("{} を書けません: {e}", to.display()))
}

/// 配る版を決める: distribute.json を書き、配る入口（その版の ZIP の exe）をアプリのフォルダの直下に置く。→ {version, notes}
pub fn set_distributed(found: &Path, version: &str, app_id: &str, who: &Who) -> Result<Value, String> {
    let scan = release::scan(found, app_id);
    let rel: &Release = scan.find(version).ok_or_else(|| format!("版 {version} は置き場にありません"))?;
    if sha256_file(&rel.zip_path()).map_err(|e| format!("版 {version} の ZIP を読めません: {e}"))? != rel.sha256 {
        return Err(format!("版 {version} の ZIP の指紋が release.json と違います（置いている途中か、壊れています）"));
    }
    let folder = app_folder(found, &scan, &rel.name);
    let mut notes = vec![];
    // 配る入口: 指紋を確かめた ZIP からだけ取り出す
    let entry = folder.join(&rel.exe);
    let tmp = folder.join(format!(".{}.new-{}", rel.exe, std::process::id()));
    extract_exe(&rel.zip_path(), &rel.exe, &tmp)?;
    if let Err(e) = update::rename_patiently(&tmp, &entry) {
        let _ = std::fs::remove_file(&tmp);
        notes.push(format!(
            "配る入口（{}）を置き換えられませんでした（だれかが入口を開いている最中かもしれません）。少し待ってから、もう一度「この版を配る」を押してください: {e}",
            entry.display()
        ));
    }
    let prev = scan.distribute.as_ref();
    let previous = prev.map(|d| d.version.clone()).filter(|v| v != version);
    // 入口の名前が変わった版を配ったとき、前の名前の入口は、その版の ZIP に同じ名前の exe（名前の歴史・brand.json の legacy_exe）が
    // あれば置き換えて残す（前に渡したアドレスでも新しい PC が入れる）。無ければ消す
    let mut olds: Vec<String> = prev.and_then(|d| d.raw["entry"].as_str()).map(str::to_string).into_iter().collect();
    olds.extend(entry_aliases(prev.map(|d| &d.raw)));
    let mut aliases: Vec<String> = vec![];
    for old in olds.into_iter().filter(|e| *e != rel.exe && release::safe_name(e)) {
        if aliases.contains(&old) {
            continue;
        }
        let tmp = folder.join(format!(".{old}.new-{}", std::process::id()));
        let kept = extract_exe(&rel.zip_path(), &old, &tmp).is_ok() && update::rename_patiently(&tmp, &folder.join(&old)).is_ok();
        let _ = std::fs::remove_file(&tmp);
        if kept {
            aliases.push(old);
        } else {
            let _ = std::fs::remove_file(folder.join(&old));
        }
    }
    let d = json!({"schema": 1, "app_id": app_id, "version": version, "entry": rel.exe, "aliases": aliases, "setAt": now_text(),
                   "setBy": who.login, "setPc": who.pc, "previous": previous});
    write_json(&folder.join(DISTRIBUTE), &d)?;
    Ok(json!({"version": version, "notes": notes, "entry": entry}))
}

/// 推奨アップデートの札を付ける・外す（配っている版にだけ。配る版はそのまま）。note は知らせに添える短い理由（120 字まで）。→ {version, recommended}
pub fn set_recommended(found: &Path, app_id: &str, version: &str, on: bool, note: &str, who: &Who) -> Result<Value, String> {
    let scan = release::scan(found, app_id);
    let dist = scan.distribute.as_ref().ok_or("配る版がまだ決まっていません。先に「この版を配る」で配る版を決めてください")?;
    if dist.version != version {
        return Err(format!("推奨の札は、配っている版（{}）にだけ付けられます（版 {version} は配っていません）", dist.version));
    }
    let mut d = dist.raw.clone();
    let rec = on.then(|| {
        let note: String = note.trim().chars().take(120).collect();
        json!({"note": note, "setAt": now_text(), "setBy": who.login, "setPc": who.pc})
    });
    match &rec {
        Some(r) => d["recommended"] = r.clone(),
        None => {
            if let Some(o) = d.as_object_mut() {
                o.remove("recommended");
            }
        }
    }
    write_json(&dist.dir.join(DISTRIBUTE), &d)?;
    Ok(json!({"version": dist.version, "recommended": rec}))
}

/// 置いた版を消す（配っている版は消さない）。→ {version, removed, notes}
/// 版のフォルダを `.<版>.removing-<pid>` に変えてから消す。名前を変えた時点で各 PC からは見えない（scan は「.」で始まる物を見ない）ので、
/// 中身を消しきれなくても（同期・だれかが開いている）消しかけの版を取り込む PC は無い。残った物は理由を添えて言う。
pub fn remove_version(found: &Path, version: &str, app_id: &str) -> Result<Value, String> {
    let scan = release::scan(found, app_id);
    if scan.distribute.as_ref().is_some_and(|d| d.version == version) {
        return Err(format!("版 {version} は配っている版なので消せません。先にほかの版を配ってから消してください"));
    }
    let dirs: Vec<&Release> = scan.versions.iter().filter(|r| r.version == version).collect();
    if dirs.is_empty() {
        return Err(format!("版 {version} は置き場にありません（もう消したか、同期待ちかもしれません）"));
    }
    let (mut removed, mut notes) = (0, vec![]);
    for r in dirs {
        let parent = r.dir.parent().ok_or_else(|| format!("{} の上のフォルダが分かりません", r.dir.display()))?;
        let gone = parent.join(format!(".{version}.removing-{}", std::process::id()));
        update::rename_patiently(&r.dir, &gone)
            .map_err(|e| format!("版 {version}（{}）を消せません（だれかが開いているかもしれません）: {e}", r.dir.display()))?;
        removed += 1;
        if let Err(e) = std::fs::remove_dir_all(&gone) {
            notes.push(format!("各 PC からはもう見えませんが、{} を消しきれませんでした。あとで手で消してください: {e}", gone.display()));
        }
    }
    Ok(json!({"version": version, "removed": removed, "notes": notes}))
}

/// 配布の画面の答え（GET /__desktop/release）。置き場をたどる（同期フォルダでは遅い）。
pub fn view(found: &Path, adjusted: bool, source: &str, app_id: &str, name: &str, me: Value) -> Value {
    view_of(&release::scan(found, app_id), found, adjusted, source, name, me)
}

/// たどり終えた置き場（scan）から、配布の画面の答えを作る（裏の確認がたどった結果を、画面へもそのまま使えるように分けてある）。
pub fn view_of(scan: &Scan, found: &Path, adjusted: bool, source: &str, name: &str, me: Value) -> Value {
    let folder = app_folder(found, scan, name);
    let versions: Vec<Value> = scan
        .by_version()
        .iter()
        .map(|r| {
            let bytes = r.raw["bytes"].as_u64().or_else(|| std::fs::metadata(r.zip_path()).ok().map(|m| m.len())).unwrap_or(0);
            json!({"version": r.version, "placedAt": r.raw["placedAt"], "placedPc": r.raw["placedPc"], "placedBy": r.raw["placedBy"],
                   "source": r.raw["source"], "zip": r.zip, "bytes": bytes, "dir": r.dir})
        })
        .collect();
    let entry = scan.distribute.as_ref().and_then(|d| d.raw["entry"].as_str().map(|e| d.dir.join(e)));
    json!({
        "reachable": true, "found": found, "adjusted": adjusted, "folder": source, "appFolder": folder,
        "distributed": scan.distribute.as_ref().map(|d| d.raw.clone()), "versions": versions,
        "entry": {"exists": entry.as_ref().is_some_and(|e| e.is_file()), "path": entry},
        "problems": scan.problems, "me": me,
    })
}

/// 前の名前の入口（distribute.json の aliases）。
fn entry_aliases(d: Option<&Value>) -> Vec<String> {
    d.and_then(|d| d["aliases"].as_array()).into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect()
}

/// いま動いている exe が「配る入口」か（隣の distribute.json がこのアプリの物で、入口か前の名前の入口が自分）。→ アプリのフォルダ
pub fn entry_folder(me: &Path, app_id: &str) -> Option<PathBuf> {
    let dir = me.parent()?;
    let d = read_json(&dir.join(DISTRIBUTE))?;
    let name = me.file_name()?.to_string_lossy().to_string();
    let names: Vec<String> = d["entry"].as_str().map(str::to_string).into_iter().chain(entry_aliases(Some(&d))).collect();
    (d["app_id"].as_str() == Some(app_id) && names.iter().any(|e| e.eq_ignore_ascii_case(&name))).then(|| dir.to_path_buf())
}

/// 配る入口から: 配る版を取り込み、この PC の app に据える（app が配る版と同じなら写さない）。入口の置き場を控える。→ 据えた版
pub fn install_from_entry(p: &Paths, folder: &Path, app_id: &str, progress: &dyn Fn(&str)) -> Result<String, String> {
    let d = read_json(&folder.join(DISTRIBUTE)).ok_or("配る版の覚え（distribute.json）を読めません")?;
    let version = d["version"].as_str().unwrap_or("").to_string();
    let _ = write_json(&p.root.join("entry.json"), &json!({"dir": folder, "at": now_text()}));
    let _ = write_json(&p.want(), &d);
    if update::program_version(&p.app().join("program")).as_deref() == Some(version.as_str()) {
        return Ok(version);
    }
    let scan = release::scan(folder, app_id);
    let rel = scan.find(&version).ok_or_else(|| format!("配る版 {version} が置き場にありません（同期待ちかもしれません）"))?;
    update::stage_release(p, rel, app_id, progress)?;
    progress("この PC へ据えています");
    update::apply_staged(p, &rel.exe)?;
    update::confirm(p);
    Ok(version)
}

/// 控えた入口の置き場（参照先の更新の置き場の後ろの候補にする）。
pub fn remembered_entry(p: &Paths) -> Option<PathBuf> {
    read_json(&p.root.join("entry.json"))?["dir"].as_str().map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "local.test.app";

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("da-dist-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// 配る ZIP を作る（App/App.exe・program/…）。
    fn make_zip(out: &Path, version: &str, exe_body: &str, app_id: &str) {
        make_zip_named(out, version, "App.exe", exe_body, app_id, &[]);
    }

    /// exe の名前と、同じ中身で置く前の名前の exe（名前の歴史）を選べる配る ZIP。
    fn make_zip_named(out: &Path, version: &str, exe: &str, exe_body: &str, app_id: &str, legacy: &[&str]) {
        let mut z = zip::ZipWriter::new(std::fs::File::create(out).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        let mut files = vec![
            (format!("App/{exe}"), exe_body.to_string()),
            ("App/program/app/static/index.html".into(), "<!doctype html>".into()),
            ("App/program/app/brand.json".into(), format!(r#"{{"app_id":"{app_id}","name":"App","exe":"{exe}"}}"#)),
            ("App/program/app/version.py".into(), format!("APP_VERSION = \"{version}\"\n")),
        ];
        files.extend(legacy.iter().map(|l| (format!("App/{l}"), exe_body.to_string())));
        for (n, body) in files {
            z.start_file(n, o).unwrap();
            z.write_all(body.as_bytes()).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn place_then_distribute_then_a_new_pc_takes_it() {
        let d = tmp("flow");
        let (rels, p) = (d.join("Releases"), Paths::new(&d.join("local")));
        std::fs::create_dir_all(&rels).unwrap();
        let who = Who { login: "maint".into(), pc: "PC1".into() };
        let none = |_: &str, _: u64, _: u64| {};
        make_zip(&d.join("a.zip"), "3.10.0", "exe-1", ID);
        let r = place(&p, &rels, &d.join("a.zip"), "a.zip", ID, &who, &none).unwrap();
        assert_eq!((r["version"].as_str(), r["placedBy"].as_str()), (Some("3.10.0"), Some("maint")));
        assert!(rels.join("App").join("3.10.0").join(MARKER).is_file(), "置き場\\アプリ名\\版");
        assert!(place(&p, &rels, &d.join("a.zip"), "a.zip", ID, &who, &none).unwrap_err().contains("もう置いて"), "同じ版は置かない");
        make_zip(&d.join("other.zip"), "1.0.0", "x", "other.app");
        assert!(place(&p, &rels, &d.join("other.zip"), "o.zip", ID, &who, &none).unwrap_err().contains("このアプリ"), "ほかのアプリは断る");
        std::fs::write(d.join("junk.zip"), "not a zip").unwrap();
        assert!(place(&p, &rels, &d.join("junk.zip"), "j.zip", ID, &who, &none).is_err(), "ZIP でない物は断る");
        let left: Vec<_> = std::fs::read_dir(rels.join("App")).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(left.len(), 1, "途中の物を残さない: {left:?}");
        // 各 PC の取り込みにそのまま通る（release.rs の読み方）
        assert_eq!(release::scan(&rels, ID).newest().unwrap().version, "3.10.0");
        // 配る
        make_zip(&d.join("b.zip"), "3.10.1", "exe-2", ID);
        place(&p, &rels, &d.join("b.zip"), "b.zip", ID, &who, &none).unwrap();
        let s = set_distributed(&rels, "3.10.1", ID, &who).unwrap();
        assert!(s["notes"].as_array().unwrap().is_empty(), "{s}");
        let entry = rels.join("App").join("App.exe");
        assert_eq!(std::fs::read_to_string(&entry).unwrap(), "exe-2", "配る入口はその版の exe");
        let back = set_distributed(&rels, "3.10.0", ID, &who).unwrap();
        assert_eq!(back["version"], "3.10.0");
        let dj = read_json(&rels.join("App").join(DISTRIBUTE)).unwrap();
        assert_eq!((dj["version"].as_str(), dj["previous"].as_str()), (Some("3.10.0"), Some("3.10.1")), "戻すのも選び直し・前の版を覚える");
        assert_eq!(std::fs::read_to_string(&entry).unwrap(), "exe-1");
        assert!(set_distributed(&rels, "9.9.9", ID, &who).is_err());
        // 推奨アップデートの札: 配っている版にだけ付く・理由を添える・外せる・配る版を選び直すと外れる
        assert!(set_recommended(&rels, ID, "3.10.1", true, "", &who).unwrap_err().contains("配っている版"), "配っていない版には付けない");
        let r = set_recommended(&rels, ID, "3.10.0", true, "  画像の読み込みの直し  ", &who).unwrap();
        let dj = read_json(&rels.join("App").join(DISTRIBUTE)).unwrap();
        assert_eq!(
            (dj["recommended"]["note"].as_str(), dj["version"].as_str()),
            (Some("画像の読み込みの直し"), Some("3.10.0")),
            "札だけを足し、ほかはそのまま: {r}"
        );
        set_recommended(&rels, ID, "3.10.0", false, "", &who).unwrap();
        assert!(read_json(&rels.join("App").join(DISTRIBUTE)).unwrap()["recommended"].is_null(), "外せる");
        set_recommended(&rels, ID, "3.10.0", true, "", &who).unwrap();
        set_distributed(&rels, "3.10.1", ID, &who).unwrap();
        let dj = read_json(&rels.join("App").join(DISTRIBUTE)).unwrap();
        assert!(dj["recommended"].is_null(), "選び直すと札は外れる");
        set_distributed(&rels, "3.10.0", ID, &who).unwrap(); // 後の確かめのため、配る版を 3.10.0 に戻す
                                                             // 画面の答え
        let v = view(&rels, false, "src", ID, "App", json!({}));
        assert_eq!((v["versions"].as_array().unwrap().len(), v["entry"]["exists"].as_bool()), (2, Some(true)));
        // 新しい PC: 入口を開くだけで配る版を取り込み、app に据える
        assert_eq!(entry_folder(&entry, ID), Some(rels.join("App")), "隣に distribute.json がある入口");
        assert_eq!(entry_folder(&d.join("a.zip"), ID), None);
        let got = install_from_entry(&p, &rels.join("App"), ID, &|_| {}).unwrap();
        assert_eq!(got, "3.10.0");
        assert_eq!(update::program_version(&p.app().join("program")).as_deref(), Some("3.10.0"));
        assert_eq!(remembered_entry(&p), Some(rels.join("App")), "入口の置き場を控える");
        assert_eq!(read_json(&p.want()).unwrap()["version"], "3.10.0", "配る版を覚える");
        assert_eq!(install_from_entry(&p, &rels.join("App"), ID, &|_| {}).unwrap(), "3.10.0", "2 回目は写さない");
        // 消す: 配っている版は消さない。ほかの版は消え、各 PC の一覧からも消える
        assert!(remove_version(&rels, "3.10.0", ID).unwrap_err().contains("配っている版"), "配っている版は消さない");
        let r = remove_version(&rels, "3.10.1", ID).unwrap();
        assert_eq!((r["removed"].as_u64(), r["notes"].as_array().unwrap().len()), (Some(1), 0), "{r}");
        assert!(!rels.join("App").join("3.10.1").exists(), "版のフォルダが消える");
        let left: Vec<_> = std::fs::read_dir(rels.join("App")).unwrap().flatten().map(|e| e.file_name()).collect();
        assert!(left.iter().all(|n| !n.to_string_lossy().contains("removing")), "消しかけを残さない: {left:?}");
        assert_eq!(release::scan(&rels, ID).by_version().len(), 1);
        assert!(remove_version(&rels, "3.10.1", ID).unwrap_err().contains("ありません"), "無い版は断る");
        assert_eq!(read_json(&rels.join("App").join(DISTRIBUTE)).unwrap()["version"], "3.10.0", "配る版はそのまま");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_renamed_exe_keeps_the_old_entry_while_the_zip_carries_it() {
        let d = tmp("rename");
        let rels = d.join("Releases");
        std::fs::create_dir_all(&rels).unwrap();
        let (p, who, none) = (Paths::new(&d.join("local")), Who::default(), |_: &str, _: u64, _: u64| {});
        let app = rels.join("App");
        make_zip(&d.join("a.zip"), "3.18.2", "old-exe", ID);
        place(&p, &rels, &d.join("a.zip"), "a.zip", ID, &who, &none).unwrap();
        set_distributed(&rels, "3.18.2", ID, &who).unwrap();
        // 名前を変えた版: 入口は New.exe、ZIP に前の名前の App.exe を同じ中身で入れる
        make_zip_named(&d.join("b.zip"), "3.19.0", "New.exe", "new-exe", ID, &["App.exe"]);
        place(&p, &rels, &d.join("b.zip"), "b.zip", ID, &who, &none).unwrap();
        set_distributed(&rels, "3.19.0", ID, &who).unwrap();
        assert_eq!(std::fs::read_to_string(app.join("New.exe")).unwrap(), "new-exe", "新しい名前の入口");
        assert_eq!(std::fs::read_to_string(app.join("App.exe")).unwrap(), "new-exe", "前の名前の入口は新しい中身で残す");
        assert_eq!(read_json(&app.join(DISTRIBUTE)).unwrap()["aliases"], json!(["App.exe"]));
        assert_eq!(entry_folder(&app.join("App.exe"), ID), Some(app.clone()), "前に渡したアドレスでも配る入口として開く");
        assert_eq!(entry_folder(&app.join("New.exe"), ID), Some(app.clone()));
        // 名前の歴史を外した版（ZIP に App.exe が無い）を配れば、前の名前の入口は消える
        make_zip_named(&d.join("c.zip"), "3.20.0", "New.exe", "newer", ID, &[]);
        place(&p, &rels, &d.join("c.zip"), "c.zip", ID, &who, &none).unwrap();
        set_distributed(&rels, "3.20.0", ID, &who).unwrap();
        assert!(!app.join("App.exe").exists() && read_json(&app.join(DISTRIBUTE)).unwrap()["aliases"] == json!([]));
        assert_eq!(entry_folder(&app.join("App.exe"), ID), None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_half_removed_version_is_not_seen_by_any_pc() {
        let d = tmp("half");
        let rels = d.join("Releases");
        let dir = rels.join("App").join(".3.10.1.removing-1");
        std::fs::create_dir_all(&dir).unwrap();
        let rel = json!({"schema": 1, "app_id": ID, "name": "App", "version": "3.10.1", "zip": "a.zip", "sha256": "a".repeat(64), "exe": "App.exe"});
        std::fs::write(dir.join(MARKER), serde_json::to_vec(&rel).unwrap()).unwrap();
        assert!(release::scan(&rels, ID).versions.is_empty(), "消しかけ（「.」で始まる名前）は取り込まない");
        let _ = std::fs::remove_dir_all(&d);
    }
}
