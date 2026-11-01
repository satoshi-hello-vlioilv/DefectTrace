//! 配る形と更新の通しを、本物の窓で確かめる（評価関数）。Windows の CI と、手元の Linux（xvfb-run の下）で流す。
//!
//! ```text
//! cargo xtask verify-update --exe <作った exe> [--work <作業フォルダ>] [--keep]
//! ```
//!
//! 利用者の PC を真似る: 作業場所（DT_LOCAL_ROOT）はまっさら、配る形は共有を真似たフォルダ、更新の置き場も共有を真似たフォルダ。
//! 窓は自己診断（DT_SELFTEST）で起こし、結果のファイル（selftest.js が更新の係の状態と、動いている exe・program を添える）を読む。
//!
//!   1. 共有の exe を開く → この PC の app へ写り、版ごとの写しの窓で開く。使っている間に置き場の次の版（+1）を取り込む（ready）。置き場を控える
//!   2. app の exe（ショートカットの行き先）を開く → 起動の最初に +1 へ入れ替わり、その版で開く。直前の版は控えに
//!   3. 閉じている間に次の版（+2）を置く → ショートカットから 1 回開くだけで +2 になる（起動の最初に取り込んで入れ替える）
//!   4. 閉じている間に画面が開けない版（+3）を置いて 1 回開く → +3 へ入れ替えるが開けず、控え（+2）へ戻して開き直す。+3 には印が付き、もう取り込まない
//!   5. 配る版を前の版（+1。distribute.json）に戻す → 1 回開くだけで配る版になり、配る版を作業場所に覚える（want.json）
//!   6. 新しい PC（まっさらな作業場所）が配る入口を開くだけで、配る版をこの PC へ入れて開き、入口の置き場を控える
//!
//! ショートカット: 無ければ画面が尋ねる・共有を指すショートカットは次の起動でこの PC の app（作業フォルダも）に直す
//! あわせて: 共有の配る形は 1 ファイルも変わらない・終わったあと窓が残らない。

use crate::bundle::{self, pretty, walk};
use crate::selftest::{info, write_config};
use crate::{fixture, version};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// 窓の結果を待つ長さ
const WAIT: Duration = Duration::from_secs(240);

fn bump(v: &str, n: u64) -> String {
    let (a, b, c) = version::version_key(v).expect("版");
    format!("{a}.{b}.{}", c + n)
}

fn tree_digest(root: &Path) -> String {
    let mut h = Sha256::new();
    for (rel, p) in walk(root) {
        h.update(rel.as_bytes());
        h.update(std::fs::read(p).unwrap_or_default());
    }
    format!("{:x}", h.finalize())
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    for (rel, p) in walk(from) {
        let dst = to.join(&rel);
        std::fs::create_dir_all(dst.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::copy(&p, &dst).map_err(|e| format!("{}: {e}", p.display()))?;
    }
    Ok(())
}

fn read_json(p: &Path) -> Value {
    std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)
}

fn brand_text(key: &str) -> String {
    bundle::brand(&version::program()).ok().and_then(|b| b.get(key).and_then(Value::as_str).map(String::from)).unwrap_or_default()
}

/// 配る形 stage の版を書き換えて ZIP にし、置き場の <アプリ>/versions/<版>/（old_layout なら版 4.3.0 までの <アプリ>/<版>/）に
/// release.json と並べて置く。broken: 画面が開けない版（取り込みの確かめは通る。画面の JS が最初に止まり、開けた合図を送らない）
fn place(stage: &Path, ver: &str, rel_root: &Path, broken: bool, old_layout: bool) -> Result<(), String> {
    let b = bundle::brand(&version::program())?;
    let name = b["name"].as_str().unwrap_or_default().to_string();
    let work = std::env::temp_dir().join(format!("da-variant-{}-{ver}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    let top = work.join(&name);
    copy_tree(stage, &top)?;
    version::set_version(&top.join("program"), ver)?;
    if broken {
        std::fs::write(top.join("program").join("app").join("static").join("app.js"), "throw new Error(\"試験のために壊した版\");\n")
            .map_err(|e| e.to_string())?;
    }
    let dest = if old_layout { rel_root.join(&name).join(ver) } else { rel_root.join(&name).join("versions").join(ver) };
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let zip_name = format!("{name}-{ver}-windows.zip");
    bundle::zip_dir(&top, &name, &dest.join(&zip_name))?;
    let rel = bundle::release_json(&b, ver, &zip_name, &bundle::sha256_file(&dest.join(&zip_name))?)?;
    std::fs::write(dest.join("release.json"), pretty(&rel)).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&work);
    Ok(())
}

/// 窓を開いて、自己診断の結果を待つ係
struct Run {
    work: PathBuf,
    env: Vec<(OsString, OsString)>,
    n: usize,
}

impl Run {
    /// exe を開き、自己診断の結果を待つ（入口・写し・開き直しの窓をたどった先の窓が書く）。
    fn open(&mut self, exe: &Path, label: &str) -> Value {
        self.n += 1;
        let out = self.work.join(format!("selftest-{}-{label}.json", self.n));
        let started = Command::new(exe)
            .current_dir(exe.parent().unwrap())
            .env_clear()
            .envs(self.env.iter().cloned())
            .env("DT_SELFTEST", &out)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        if let Err(e) = started {
            return json!({"ok": false, "error": format!("{} を開けません: {e}", exe.display())});
        }
        let end = Instant::now() + WAIT;
        while Instant::now() < end && !out.exists() {
            std::thread::sleep(Duration::from_secs(1));
        }
        std::thread::sleep(Duration::from_secs(3)); // 窓が終わるのを待つ
        if !out.exists() {
            return json!({"ok": false, "error": format!("{} 秒たっても結果がありません（{label}）", WAIT.as_secs())});
        }
        let mut r = read_json(&out);
        // 試験の版は program の版だけを書き換えた物（窓の exe は元の版のまま）なので、「窓の版と中身の版が同じ」は数えない。
        // 本物の配る形では、窓と中身は同じ版で作る（bundle.rs・xtask の試験 tests/repo.rs）
        if let Some(results) = r.get("results").and_then(Value::as_array).cloned() {
            let res: Vec<&Value> = results.iter().filter(|x| x["name"] != "窓の版と中身の版が同じ").collect();
            for x in &res {
                if x["ok"] != true {
                    println!("  [{label}] FAIL {} -- {}", info(&x["name"]), info(&x["info"]));
                }
            }
            r["ok"] = json!(!res.is_empty() && res.iter().all(|x| x["ok"] == true));
        }
        r
    }
}

fn check(cond: bool, what: &str, detail: impl std::fmt::Display) -> bool {
    let d = detail.to_string();
    println!(
        "{} {what}{}",
        if cond { "PASS" } else { "FAIL" },
        if d.is_empty() || d == "null" { String::new() } else { format!(" -- {d}") }
    );
    cond
}

/// 人が作ったショートカットを真似る（Windows は WScript.Shell、ほかは窓の lnk.rs と同じ小さな JSON）。
fn make_link(link: &Path, target: &Path, workdir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(link.parent().unwrap()).map_err(|e| e.to_string())?;
    if cfg!(windows) {
        let ps = format!(
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
            link.display(),
            target.display(),
            workdir.display()
        );
        let st = Command::new("powershell").args(["-NoProfile", "-Command", &ps]).status().map_err(|e| e.to_string())?;
        return if st.success() { Ok(()) } else { Err("ショートカットを作れません".into()) };
    }
    std::fs::write(link, json!({"target": target, "workdir": workdir, "description": ""}).to_string()).map_err(|e| e.to_string())
}

/// → (指す先, 作業フォルダ)。無ければ None。
fn read_link(link: &Path) -> Option<(PathBuf, PathBuf)> {
    if !link.exists() {
        return None;
    }
    if cfg!(windows) {
        let ps = format!("$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath;$s.WorkingDirectory", link.display());
        let out = Command::new("powershell").args(["-NoProfile", "-Command", &ps]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        let mut lines = text.lines();
        return Some((PathBuf::from(lines.next()?.trim()), PathBuf::from(lines.next()?.trim())));
    }
    let v = read_json(link);
    Some((PathBuf::from(v["target"].as_str()?), PathBuf::from(v["workdir"].as_str()?)))
}

/// 同じ場所か（実の場所で。Windows は大文字と小文字・区切りの字を区別せず、canonicalize が付ける \\?\ の頭を外す）
fn same(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let s = p.canonicalize().unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().to_string();
        if cfg!(windows) {
            s.strip_prefix(r"\\?\").unwrap_or(&s).replace('/', "\\").to_lowercase()
        } else {
            s
        }
    };
    norm(a) == norm(b)
}

/// 作業フォルダの exe（版ごとの写し・入口）がまだ動いていないか（Linux は /proc。Windows は省く）。
fn leftover_windows(root: &Path) -> Vec<String> {
    if cfg!(windows) {
        return vec![];
    }
    let root = root.to_string_lossy().to_string();
    std::fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .flatten()
        .filter(|d| d.file_name().to_string_lossy().chars().all(|c| c.is_ascii_digit()))
        .filter_map(|d| {
            let exe = std::fs::read_link(d.path().join("exe")).ok()?;
            exe.to_string_lossy().starts_with(&root).then(|| format!("{}: {}", d.file_name().to_string_lossy(), exe.display()))
        })
        .collect()
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn short(v: &Value, n: usize) -> String {
    v.to_string().chars().take(n).collect()
}

fn unzip(zip: &Path, to: &Path) -> Result<(), String> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(zip).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    z.extract(to).map_err(|e| e.to_string())
}

/// 更新の通しを流す。→ 全部通ったか
pub fn update(exe: &Path, work: &Path) -> Result<bool, String> {
    let (name, exe_name, app_id) = (brand_text("name"), brand_text("exe"), brand_text("app_id"));
    let _ = std::fs::remove_dir_all(work);
    std::fs::create_dir_all(work).map_err(|e| e.to_string())?;
    let built = bundle::build(exe, &work.join("out"))?;
    let v0 = built.release.version.clone();
    let (v1, v2, v3) = (bump(&v0, 1), bump(&v0, 2), bump(&v0, 3));
    let share = work.join("share");
    unzip(&built.path, &share)?;
    let share_app = share.join(&name);
    let share_exe = share_app.join(&exe_name);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&share_exe, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    let share_digest = tree_digest(&share_app);
    let rel_root = work.join("Releases");
    place(&built.stage, &v0, &rel_root, false, true)?; // 置き場には配った版も並ぶ（版 4.3.0 までの形のまま読めるか）
    place(&built.stage, &v1, &rel_root, false, false)?;
    let fx = work.join("fx");
    fixture::golden_tree(&fx);
    let local = work.join("local");
    write_config(&fx, &local, Some(&rel_root.to_string_lossy()))?;
    let links = [work.join("links").join("Desktop"), work.join("links").join("Programs")];
    let join_paths = |ps: &[PathBuf]| std::env::join_paths(ps).expect("場所の並び");
    // 試験が渡す物は外してから足す（手元の環境変数が混ざらない）。Unicode でない値もそのまま渡す
    let mut env: Vec<(OsString, OsString)> = std::env::vars_os()
        .filter(|(k, _)| !matches!(k.to_str(), Some("DT_NO_HANDOFF" | "DT_PROGRAM_DIR" | "DT_SELFTEST" | "DT_LOCAL_ROOT" | "DT_LINK_DIRS")))
        .collect();
    env.push(("DT_LOCAL_ROOT".into(), local.clone().into_os_string()));
    env.push(("DT_LINK_DIRS".into(), join_paths(&links)));
    let mut run = Run { work: work.to_path_buf(), env: env.clone(), n: 0 };
    let app = local.join("app");
    let ver_of = |program: &Path| version::read(program).map(|v| v.version).unwrap_or_default();
    let mut ok = true;

    // 1. 共有の exe を開く
    let r = run.open(&share_exe, "share");
    let (i, upd) = (&r["info"], &r["update"]);
    ok &= check(r["ok"] == true, "1. 共有の exe で開くと自己診断が通る", info(&r["error"]));
    ok &= check(same(Path::new(&s(&i["program"])), &app.join("program")), "1. この PC の app の program で動く", info(&i["program"]));
    ok &= check(
        s(&i["exe"]).contains(&local.join("desktop").to_string_lossy().to_string()),
        "1. 窓は版ごとの写しで動く（app を掴まない）",
        info(&i["exe"]),
    );
    ok &= check(i["installed"] == true && s(&i["version"]) == v0, &format!("1. 版 {v0}"), i);
    ok &= check(upd["state"] == "ready" && s(&upd["ready"]) == v1, &format!("1. 使っている間に {v1} を取り込んだ"), short(upd, 300));
    ok &= check(ver_of(&app.join("program")) == v0, "1. 取り込んでも動いている app はそのまま", "");
    let sc = &r["install"]["shortcut"];
    ok &= check(sc["ask"] == true && sc["links"].as_array().is_none_or(|a| a.is_empty()), "1. ショートカットが無いので画面が尋ねる", sc);
    let made: Vec<&Value> =
        r["results"].as_array().into_iter().flatten().filter(|x| s(&x["name"]).contains("ショートカットができる")).collect();
    ok &= check(
        made.len() == 1 && made[0]["ok"] == true,
        "1. 帯の「作る」を押すと、デスクトップとスタートにショートカットができる",
        made.first().map(|m| info(&m["info"])).unwrap_or_else(|| "自己診断が押していない".into()),
    );
    ok &= check(links.iter().all(|d| d.join(format!("{name}.lnk")).is_file()), "1. 置き場に .lnk ができた", format!("{links:?}"));
    // 人が作った、共有の exe を指し作業フォルダも共有のショートカット（次の起動で直る）
    let lnk = links[0].join(format!("{name}.lnk"));
    make_link(&lnk, &share_exe, &share_app)?;

    // 2. ショートカットの行き先（app の exe）で開く → 入れ替わる
    let app_exe = app.join(&exe_name);
    let r = run.open(&app_exe, "app");
    let (i, upd) = (&r["info"], &r["update"]);
    ok &= check(r["ok"] == true, "2. app の exe で開くと自己診断が通る", info(&r["error"]));
    ok &= check(s(&i["version"]) == v1, &format!("2. 起動の最初に {v1} へ入れ替わった"), info(&i["version"]));
    ok &= check(ver_of(&local.join("update").join("old").join("program")) == v0, &format!("2. 直前の版 {v0} は控えに"), "");
    ok &= check(upd["state"] == "latest", "2. 置き場の最新を使っている", info(&upd["state"]));
    let got = read_link(&lnk);
    ok &= check(
        got.as_ref().is_some_and(|(t, w)| same(t, &app_exe) && same(w, &app)),
        "2. 共有を指していたショートカットを、この PC の app（作業フォルダも app）に直した",
        format!("{got:?}"),
    );
    ok &= check(
        local.join("update").join("source.json").is_file(),
        "2. 更新の置き場を控えた（次の起動の最初に、中身を起こす前に確かめる）",
        "",
    );

    // 3. 閉じている間に次の版を置く → ショートカットから 1 回開くだけで入れ替わる（要望 2026-10: 以前は 2 回開く必要があった）
    place(&built.stage, &v2, &rel_root, false, false)?;
    let r = run.open(&app_exe, "closed-new");
    let (i, upd) = (&r["info"], &r["update"]);
    ok &= check(
        r["ok"] == true && s(&i["version"]) == v2,
        &format!("3. 閉じている間に置いた {v2} に、1 回の起動で入れ替わった"),
        info(&i["version"]),
    );
    ok &= check(upd["state"] == "latest", "3. 開いたあとは置き場の最新を使っている", info(&upd["state"]));

    // 4. 閉じている間に起動できない版を置いて 1 回開く → 入れ替えるが起動できず、控えへ戻して開き直す
    place(&built.stage, &v3, &rel_root, true, false)?;
    let r = run.open(&app_exe, "revert");
    let (i, upd) = (&r["info"], &r["update"]);
    ok &=
        check(r["ok"] == true && s(&i["version"]) == v2, &format!("4. {v3} は画面が開けず、{v2} に戻して開き直した"), info(&i["version"]));
    let failed = read_json(&local.join("update").join("FAILED.json"))["versions"].clone();
    ok &= check(failed == json!([v3]), &format!("4. {v3} に開けなかった印"), &failed);
    ok &= check(
        upd["state"] == "latest" && upd["failed"].as_array().is_some_and(|a| a.contains(&json!(v3))),
        "4. 起動できなかった版はもう取り込まない",
        short(upd, 300),
    );

    // 5. 配る版を前の版（v1）に戻す → 1 回開くだけで配る版になり、配る版を作業場所に覚える
    let dist = json!({"schema": 1, "app_id": app_id, "version": v1, "entry": exe_name,
        "setAt": chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(), "setBy": "verify", "setPc": "verify", "previous": v2});
    std::fs::write(rel_root.join(&name).join("distribute.json"), dist.to_string()).map_err(|e| e.to_string())?;
    let r = run.open(&app_exe, "distribute-down");
    let (i, upd) = (&r["info"], &r["update"]);
    let want = read_json(&local.join("want.json"));
    ok &= check(
        r["ok"] == true && s(&i["version"]) == v1,
        &format!("5. 配る版を {v1} に戻すと、1 回の起動でその版になる"),
        info(&i["version"]),
    );
    ok &= check(s(&want["version"]) == v1, "5. 配る版を作業場所に覚えた（画面が最新版かを出すのに使う）", &want);
    ok &= check(upd["state"] == "latest", "5. 開いたあとは配る版を使っている", short(upd, 300));

    // 6. 新しい PC: 配る入口（置き場のアプリのフォルダの exe）を開くだけで、配る版を取り込んでこの PC で開く
    let entry = rel_root.join(&name).join(&exe_name);
    std::fs::copy(&share_exe, &entry).map_err(|e| e.to_string())?;
    let local2 = work.join("local-new-pc");
    write_config(&fx, &local2, None)?;
    let mut env2 = env.clone();
    env2.retain(|(k, _)| k != "DT_LOCAL_ROOT" && k != "DT_LINK_DIRS");
    env2.push(("DT_LOCAL_ROOT".into(), local2.clone().into_os_string()));
    env2.push(("DT_LINK_DIRS".into(), join_paths(&[work.join("links2").join("Desktop"), work.join("links2").join("Programs")])));
    let mut run2 = Run { work: work.to_path_buf(), env: env2, n: run.n };
    let r = run2.open(&entry, "entry");
    let i = &r["info"];
    ok &= check(
        r["ok"] == true && s(&i["version"]) == v1 && i["installed"] == true,
        &format!("6. 配る入口を開くと、配る版 {v1} をこの PC の app に入れて開く"),
        short(i, 300),
    );
    ok &= check(same(Path::new(&s(&i["program"])), &local2.join("app").join("program")), "6. 動くのはこの PC の app", info(&i["program"]));
    let remembered = s(&read_json(&local2.join("entry.json"))["dir"]);
    ok &= check(
        !remembered.is_empty() && same(Path::new(&remembered), &rel_root.join(&name)),
        "6. 入口の置き場を控えた（設定の置き場が無い PC でも更新が届く）",
        &remembered,
    );

    ok &= check(tree_digest(&share_app) == share_digest, "共有の配る形は 1 ファイルも変わらない", "");
    std::thread::sleep(Duration::from_secs(2));
    let left = leftover_windows(work);
    ok &= check(left.is_empty(), "終わったあと窓が残らない", format!("{left:?}"));
    Ok(ok)
}
