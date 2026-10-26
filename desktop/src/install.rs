//! ショートカット（program/docs/DISTRIBUTION.md）。決めるのはここ、.lnk を作る・読むのは窓の lnk.rs（Windows の IShellLinkW）。
//!
//! - ショートカットはいつもこの PC の app の exe（入口）を指し、作業フォルダも app（共有を作業フォルダにしない）
//! - 置き場はデスクトップとスタート（プログラム）。どこへ作るかは窓が Windows に尋ねる（OneDrive へ移したデスクトップでもよい）
//! - 尋ねる: app があり、置き場に正しいショートカットが 1 つも無く、断っていなければ（画面が「作りますか」と尋ねる）
//! - 「今後たずねない」はこの PC の記録（作業場所の install.json の declined）。作れば断りは消える
//! - 起動のたび（maintain）: 置き場にあるこのアプリのショートカットで、指す先か作業フォルダが違う物（共有の exe・前の名前）を作り直す。
//!   前の名前（アプリ名を変える前）の物は消して、いまの名前で作る。消された物は作り直さない
//! - アイコンは exe の中の絵ではなく、作業場所の `icon\<絵の指紋>.ico` を指す。Windows はショートカットの絵を
//!   「指す場所」で覚えるので、exe を入れ替えても場所が同じだと古い絵を出し続ける。絵が変われば指紋（場所）も変わるので、
//!   起動のたびに指す絵が違う物を作り直せば、Windows は新しい絵を読む。タスクバーにピン留めした物も直す（作りはしない）

use crate::update::{read_json, write_json, Paths};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// ショートカットの中身。
#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub target: PathBuf,
    pub workdir: PathBuf,
    /// アイコンの場所（0 番の絵）
    pub icon: PathBuf,
}

/// ショートカットを作る・読む手段（窓では Windows の部品、試験では作り物）。
pub trait LinkIo {
    /// 作る（上書き）。
    fn make(&self, link: &Path, to: &Link, description: &str) -> Result<(), String>;
    /// 読む。無い・読めなければ None。
    fn read(&self, link: &Path) -> Option<Link>;
}

/// 名前（いまのアプリ名と、前の名前の歴史）とアイコン。
pub struct Names<'a> {
    pub name: &'a str,
    pub exe: &'a str,
    pub description: &'a str,
    /// 前の名前（名前の歴史: アプリ名を変える前の名前）。見つけたら消していまの名前で作る
    pub legacy: &'a [String],
    /// ショートカットが指すアイコン（icon_file で書き出した物。書けなければ exe）
    pub icon: PathBuf,
}

/// アイコンの絵を作業場所の `icon\<指紋>.ico` へ書き出す（同じ絵ならそのまま）。ほかの指紋の古い絵は消す → 場所。
pub fn icon_file(p: &Paths, ico: &[u8]) -> Result<PathBuf, String> {
    let dir = p.root.join("icon");
    let sum = format!("{:x}", Sha256::digest(ico));
    let path = dir.join(format!("{}.ico", &sum[..12]));
    if std::fs::read(&path).ok().as_deref() != Some(ico) {
        std::fs::create_dir_all(&dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
        let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
        std::fs::write(&tmp, ico).and_then(|_| std::fs::rename(&tmp, &path)).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("{} を書けません: {e}", path.display())
        })?;
    }
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let old = e.path();
        if old != path && old.extension().is_some_and(|x| x == "ico") {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(path)
}

/// このアプリのショートカットが持つべき中身（この PC の app の exe・作業フォルダも app・アイコン）。
fn want(p: &Paths, n: &Names) -> Link {
    Link { target: p.app().join(n.exe), workdir: p.app(), icon: n.icon.clone() }
}

fn record_path(p: &Paths) -> PathBuf {
    p.root.join("install.json")
}

fn record(p: &Paths) -> Value {
    read_json(&record_path(p)).filter(Value::is_object).unwrap_or_else(|| json!({}))
}

fn save(p: &Paths, v: &Value) -> Result<(), String> {
    write_json(&record_path(p), v)
}

fn same(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let (x, y) = (norm(a), norm(b));
    if cfg!(windows) {
        x.to_string_lossy().to_lowercase() == y.to_string_lossy().to_lowercase()
    } else {
        x == y
    }
}

fn link_name(name: &str) -> String {
    format!("{name}.lnk")
}

/// 指す先と作業フォルダが正しいか（アイコンは問わない。違えば起動のたびに直す）。
fn opens_app(l: &Link, w: &Link) -> bool {
    same(&l.target, &w.target) && same(&l.workdir, &w.workdir)
}

/// 置き場にある正しいショートカット（app の exe を指し、作業フォルダも app）。
pub fn good_links(p: &Paths, places: &[PathBuf], io: &dyn LinkIo, n: &Names) -> Vec<PathBuf> {
    let w = want(p, n);
    places.iter().map(|d| d.join(link_name(n.name))).filter(|l| io.read(l).is_some_and(|x| opens_app(&x, &w))).collect()
}

/// 画面への答え（GET /__desktop/install）。
pub fn status(p: &Paths, places: &[PathBuf], io: &dyn LinkIo, n: &Names, running_from_app: bool) -> Value {
    let installed = p.app().join(n.exe).is_file() && crate::update::has_program(&p.app());
    let links = good_links(p, places, io, n);
    let declined = record(p)["declined"] == true;
    json!({
        "installed": installed, "runningFromApp": running_from_app, "local": p.root, "appDir": p.app(), "name": n.name,
        "shortcut": {"links": links, "places": places, "ask": installed && links.is_empty() && !declined && !places.is_empty(),
                     "declined": declined},
    })
}

/// 作る（POST /__desktop/shortcut）。→ {made, problems}。作れば断りは消える。
pub fn make(p: &Paths, places: &[PathBuf], io: &dyn LinkIo, n: &Names) -> Result<Value, String> {
    let w = want(p, n);
    if !w.target.is_file() {
        return Err("この PC のアプリ（app）がまだありません。共有・BOX の exe から一度開いてください".into());
    }
    let (mut made, mut problems) = (vec![], vec![]);
    for d in places {
        let link = d.join(link_name(n.name));
        let r = std::fs::create_dir_all(d).map_err(|e| e.to_string()).and_then(|_| io.make(&link, &w, n.description));
        match r {
            Ok(()) => made.push(link),
            Err(e) => problems.push(format!("{}: {e}", link.display())),
        }
    }
    let mut rec = record(p);
    rec["declined"] = json!(false);
    rec["links"] = json!(made);
    save(p, &rec)?;
    Ok(json!({"made": made, "problems": problems}))
}

/// 「今後たずねない」（POST /__desktop/shortcut/decline）。
pub fn decline(p: &Paths) -> Result<Value, String> {
    let mut rec = record(p);
    rec["declined"] = json!(true);
    save(p, &rec)?;
    Ok(json!({"declined": true}))
}

/// 起動のたび: 置き場にあるこのアプリのショートカットの指す先・作業フォルダ・アイコンを直し、前の名前の物を作り直す。
/// pinned（タスクバーのピン留め）は、ある物の中身だけ直す（名前は変えない。変えるとピン留めが外れる）。→ 直した物
pub fn maintain(p: &Paths, places: &[PathBuf], pinned: &[PathBuf], io: &dyn LinkIo, n: &Names) -> Vec<String> {
    let w = want(p, n);
    if !w.target.is_file() {
        return vec![];
    }
    let mut fixed = vec![];
    // 中身（指す先・作業フォルダ・アイコン）が違えば、その名前のまま作り直す → 直したこと
    let refresh = |link: &Path, have: &Link| -> Option<String> {
        let why = if !opens_app(have, &w) {
            format!("指す先 {} → {}", have.target.display(), w.target.display())
        } else if !same(&have.icon, &w.icon) {
            format!("アイコン {} → {}", have.icon.display(), w.icon.display())
        } else {
            return None;
        };
        io.make(link, &w, n.description).is_ok().then(|| format!("{} を作り直しました（{why}）", link.display()))
    };
    for (d, rename) in places.iter().map(|d| (d, true)).chain(pinned.iter().map(|d| (d, false))) {
        let link = d.join(link_name(n.name));
        if let Some(f) = io.read(&link).and_then(|have| refresh(&link, &have)) {
            fixed.push(f);
        }
        for old in n.legacy.iter().filter(|o| o.as_str() != n.name) {
            let ol = d.join(link_name(old));
            let Some(have) = io.read(&ol) else { continue };
            if !rename {
                fixed.extend(refresh(&ol, &have)); // ピン留めは名前を変えると外れるので、中身だけ直す
            } else if std::fs::remove_file(&ol).is_ok() && io.make(&link, &w, n.description).is_ok() {
                fixed.push(format!("{} を {} で作り直しました", ol.display(), link.display()));
            }
        }
    }
    fixed
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// 作り物（ショートカットをファイルとして置き、中身を覚える）。
    #[derive(Default)]
    pub struct Fake(pub RefCell<HashMap<PathBuf, Link>>);
    impl LinkIo for Fake {
        fn make(&self, link: &Path, to: &Link, _d: &str) -> Result<(), String> {
            if link.parent().is_some_and(|d| d.ends_with("locked")) {
                return Err("書けません".into());
            }
            std::fs::write(link, "lnk").map_err(|e| e.to_string())?;
            self.0.borrow_mut().insert(link.to_path_buf(), to.clone());
            Ok(())
        }
        fn read(&self, link: &Path) -> Option<Link> {
            link.is_file().then(|| self.0.borrow().get(link).cloned()).flatten()
        }
    }

    fn names(icon: &Path) -> Names<'static> {
        static LEGACY: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
        let legacy = LEGACY.get_or_init(|| vec!["OldName".into()]);
        Names { name: "App", exe: "App.exe", description: "説明", legacy, icon: icon.to_path_buf() }
    }
    fn link(target: PathBuf, workdir: PathBuf) -> Link {
        Link { icon: target.clone(), target, workdir }
    }

    fn setup(name: &str) -> (PathBuf, Paths, Vec<PathBuf>) {
        let d = std::env::temp_dir().join(format!("da-inst-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let p = Paths::new(&d.join("local"));
        std::fs::create_dir_all(p.app().join("program")).unwrap();
        std::fs::write(p.app().join("App.exe"), "x").unwrap();
        std::fs::create_dir_all(p.app().join("program").join("app").join("static")).unwrap();
        std::fs::write(p.app().join("program").join("app").join("static").join("index.html"), "<!doctype html>").unwrap();
        let places = vec![d.join("Desktop"), d.join("Programs")];
        for pl in &places {
            std::fs::create_dir_all(pl).unwrap();
        }
        (d, p, places)
    }

    #[test]
    fn ask_make_decline() {
        let (d, p, places) = setup("ask");
        let io = Fake::default();
        let n = names(&p.app().join("App.exe"));
        let s = status(&p, &places, &io, &n, true);
        assert_eq!(
            (s["installed"].as_bool(), s["shortcut"]["ask"].as_bool()),
            (Some(true), Some(true)),
            "app があり、ショートカットが無ければ尋ねる"
        );
        decline(&p).unwrap();
        assert_eq!(status(&p, &places, &io, &n, true)["shortcut"]["ask"], false, "断ったら尋ねない");
        let r = make(&p, &places, &io, &n).unwrap();
        assert_eq!(r["made"].as_array().unwrap().len(), 2, "断ったあとでも作れる");
        let s = status(&p, &places, &io, &n, true);
        assert_eq!((s["shortcut"]["ask"].as_bool(), s["shortcut"]["declined"].as_bool()), (Some(false), Some(false)), "作れば断りは消える");
        for l in good_links(&p, &places, &io, &n) {
            let x = io.read(&l).unwrap();
            assert!(same(&x.target, &p.app().join("App.exe")) && same(&x.workdir, &p.app()), "指す先も作業フォルダもこの PC の app");
        }
        std::fs::remove_file(places[0].join("App.lnk")).unwrap();
        assert_eq!(status(&p, &places, &io, &n, true)["shortcut"]["ask"], false, "1 つでもあれば尋ねない");
        std::fs::remove_file(places[1].join("App.lnk")).unwrap();
        assert_eq!(status(&p, &places, &io, &n, true)["shortcut"]["ask"], true, "全部消されたらまた尋ねる");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn maintain_fixes_shared_targets_and_old_names_but_not_deleted_ones() {
        let (d, p, places) = setup("maint");
        let io = Fake::default();
        let n = names(&p.app().join("App.exe"));
        // 人が作った、共有の exe を指し作業フォルダも共有のショートカット
        io.make(&places[0].join("App.lnk"), &link(d.join("share").join("App.exe"), d.join("share")), "").unwrap();
        // 前の名前のショートカット
        io.make(&places[1].join("OldName.lnk"), &link(d.join("old").join("Old.exe"), d.join("old")), "").unwrap();
        let fixed = maintain(&p, &places, &[], &io, &n);
        assert_eq!(fixed.len(), 2, "{fixed:?}");
        assert_eq!(good_links(&p, &places, &io, &n).len(), 2, "どちらもこの PC の app を指す");
        assert!(!places[1].join("OldName.lnk").exists(), "前の名前の物は消す");
        std::fs::remove_file(places[0].join("App.lnk")).unwrap();
        assert!(maintain(&p, &places, &[], &io, &n).is_empty(), "正しい物は触らない・消された物は作り直さない");
        assert!(!places[0].join("App.lnk").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn problems_are_told_with_reason() {
        let (d, p, mut places) = setup("prob");
        places.push(d.join("locked"));
        let io = Fake::default();
        let n = names(&p.app().join("App.exe"));
        let r = make(&p, &places, &io, &n).unwrap();
        assert_eq!(r["made"].as_array().unwrap().len(), 2);
        assert!(r["problems"][0].as_str().unwrap().contains("書けません"), "作れなかった物は理由つき");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn icon_file_is_named_by_the_picture_and_drops_old_ones() {
        let (d, p, _) = setup("icon");
        let a = icon_file(&p, b"picture-A").unwrap();
        assert_eq!(icon_file(&p, b"picture-A").unwrap(), a, "同じ絵なら同じ場所");
        let b = icon_file(&p, b"picture-B").unwrap();
        assert_ne!(a, b, "絵が変われば場所も変わる（Windows が古い絵を出し続けない）");
        assert!(!a.exists() && std::fs::read(&b).unwrap() == b"picture-B", "古い絵は消し、新しい絵を置く");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn maintain_points_shortcuts_and_pins_at_the_new_icon() {
        let (d, p, places) = setup("reicon");
        let pinned = vec![d.join("TaskBar")];
        std::fs::create_dir_all(&pinned[0]).unwrap();
        let io = Fake::default();
        // 前の版で作った、exe の中の絵を指すショートカット（指す先・作業フォルダは正しい）とピン留め
        let old = names(&p.app().join("App.exe"));
        make(&p, &places, &io, &old).unwrap();
        io.make(&pinned[0].join("App.lnk"), &want(&p, &old), "").unwrap();
        let n = names(&icon_file(&p, b"new").unwrap());
        let fixed = maintain(&p, &places, &pinned, &io, &n);
        assert_eq!(fixed.len(), 3, "デスクトップ・スタート・ピン留めの 3 つ: {fixed:?}");
        for l in places.iter().chain(&pinned).map(|x| x.join("App.lnk")) {
            assert_eq!(io.read(&l).unwrap(), want(&p, &n), "新しい絵を指す（指す先・作業フォルダはそのまま）");
        }
        assert!(maintain(&p, &places, &pinned, &io, &n).is_empty(), "揃えば触らない");
        // ピン留めは作らない・名前を変えない（前の名前のピン留めは、中身だけ新しい exe と絵に直す）
        std::fs::remove_file(pinned[0].join("App.lnk")).unwrap();
        let old_pin = Link { target: p.app().join("Old.exe"), ..want(&p, &old) };
        io.make(&pinned[0].join("OldName.lnk"), &old_pin, "").unwrap();
        assert_eq!(maintain(&p, &places, &pinned, &io, &n).len(), 1);
        assert!(!pinned[0].join("App.lnk").exists(), "ピン留めは作らない");
        assert_eq!(io.read(&pinned[0].join("OldName.lnk")).unwrap(), want(&p, &n), "名前はそのまま、中身は新しい exe と絵");
        // いまの名前の物が正しくても、同じ場所の前の名前の物は片付ける
        io.make(&places[0].join("OldName.lnk"), &old_pin, "").unwrap();
        assert_eq!(maintain(&p, &places, &pinned, &io, &n).len(), 1);
        assert!(!places[0].join("OldName.lnk").exists() && io.read(&places[0].join("App.lnk")).unwrap() == want(&p, &n));
        let _ = std::fs::remove_dir_all(&d);
    }
}
