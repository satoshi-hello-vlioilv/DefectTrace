//! DefectTrace（検査計画像ビュワー）デスクトップ版の窓（Tauri）。設計は program/docs/DESKTOP.md。
//!
//! 役割の分け方:
//!   - Rust（この exe）: 窓・起動と終了・1 つだけ起動・更新と配布・画面の問い合わせ（検査データ・画像・解析。dt_core::app）
//!   - 画面（WebView2）: program/app/static の HTML/JS/CSS。問い合わせは自前の仕組み（dt）で Rust が受ける
//!
//! Python も Flask も要らない。ポートも開かないので、プロキシ・ポートの取り合い・古いサーバーの残りが無い。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lnk;
mod proc;
mod updater;

use dt_core::app::{App, Reply};
use dt_core::brand::brand;
use dt_core::config::Config;
use dt_core::install;
use dt_core::locate;
use dt_core::update::{self, Paths};
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::http::{Request, Response};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use updater::Updater;

/// 自前の仕組みの名前。Windows（WebView2）は http://dt.localhost/、ほかは dt://localhost/（Tauri の決まり）。
const SCHEME: &str = "dt";
const SELFTEST_JS: &str = include_str!("selftest.js");
const SELFTEST_LIMIT: Duration = Duration::from_secs(180);
/// 終了を受けてから窓を閉じるまで（答えが画面へ届いてから閉じる）。
const QUIT_DELAY: Duration = Duration::from_millis(150);
/// 入れ替えた直後の版で、画面が「開けた」（/__desktop/ready）と言うまで待つ長さ。過ぎたら前の版へ戻して開き直す。
const READY_LIMIT: Duration = Duration::from_secs(30);

const ERROR_WATCH_JS: &str = "window.__dtErrors=[];addEventListener('error',e=>__dtErrors.push(String(e.message||e.type)));\
addEventListener('unhandledrejection',e=>__dtErrors.push('promise: '+String(e.reason&&(e.reason.message||e.reason))));";

fn app_url(path: &str) -> Url {
    let base = if cfg!(windows) { "http://dt.localhost" } else { "dt://localhost" };
    Url::parse(&format!("{base}{path}")).expect("app url")
}

fn is_app_url(u: &Url) -> bool {
    u.scheme() == SCHEME || (matches!(u.scheme(), "http" | "https") && u.host_str() == Some("dt.localhost"))
}

fn is_splash(u: &Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost")
}

fn selftest_on() -> bool {
    std::env::var_os("DT_SELFTEST").is_some()
}

/// 窓の記録（作業場所の logs/desktop.log）。
fn log(line: &str) {
    let dir = locate::local_root().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("desktop.log")) {
        let t = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "{t} {line}");
    }
}

/// 起動画面へ伝えること。画面が読み終わる前の分はためておき、読み終わったら流す。
#[derive(Default)]
struct Splash {
    loaded: AtomicBool,
    queue: Mutex<Vec<String>>,
}

impl Splash {
    fn say(&self, app: &AppHandle, js: String) {
        let mut q = self.queue.lock().unwrap();
        if self.loaded.load(Ordering::SeqCst) {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval(&js);
            }
        } else {
            q.push(js);
        }
    }
    fn flush(&self, w: &WebviewWindow) {
        let mut q = self.queue.lock().unwrap();
        self.loaded.store(true, Ordering::SeqCst);
        for js in q.drain(..) {
            let _ = w.eval(&js);
        }
    }
    fn step(&self, app: &AppHandle, id: &str, state: &str, detail: &str) {
        self.say(app, format!("splash.step(...{})", json!([id, state, detail])));
    }
    fn fail(&self, app: &AppHandle, title: &str, detail: &str) {
        log(&format!("FAIL {title}: {}", detail.replace('\n', " / ")));
        self.say(app, format!("splash.fail(...{})", json!([title, detail])));
        selftest_finish(app, &json!({"ok": false, "error": format!("{title}: {detail}")}));
    }
}

/// 自己診断の結果を書いて終わる（DT_SELFTEST が無ければ何もしない）。
fn selftest_finish(app: &AppHandle, result: &serde_json::Value) {
    if let Some(path) = std::env::var_os("DT_SELFTEST") {
        let _ = std::fs::write(&path, serde_json::to_vec_pretty(result).unwrap_or_default());
        app.exit(if result["ok"] == true { 0 } else { 1 });
    }
}

fn json_reply(v: &serde_json::Value) -> Reply {
    Reply::json(v)
}

fn reply_of(r: Result<serde_json::Value, (u16, String)>) -> Reply {
    match r {
        Ok(v) => json_reply(&v),
        Err((status, e)) => Reply::error(status, &e),
    }
}

/// 窓そのものが答える問い合わせ（方法・道・問い合わせ文字・本文 → 答え。窓の係でなければ None）。
type Native = Box<dyn Fn(&str, &str, &str, &[u8]) -> Option<Reply> + Send + Sync>;

/// 画面の問い合わせを答える係（窓のこと → 画面の API → 静的ファイル）。
struct Router {
    app: Arc<App>,
    static_dir: PathBuf,
    version: String,
    native: Native,
}

impl Router {
    fn handle(&self, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let uri = req.uri();
        let (path, query, method) = (uri.path().to_string(), uri.query().unwrap_or("").to_string(), req.method().as_str().to_string());
        let reply = (self.native)(&method, &path, &query, req.body())
            .unwrap_or_else(|| self.app.handle_all(&method, &path, &query, req.body(), &self.static_dir, &self.version));
        to_response(reply)
    }
}

fn to_response(r: Reply) -> Response<Vec<u8>> {
    let mut b = Response::builder().status(r.status);
    for (k, v) in &r.headers {
        b = b.header(k.as_str(), v.as_str());
    }
    b.body(r.body).unwrap_or_else(|_| Response::builder().status(500).body(Vec::new()).unwrap())
}

/// ショートカットの名前とアイコン。
fn names() -> install::Names<'static> {
    let b = brand();
    install::Names { name: &b.name, exe: &b.exe, description: &b.subtitle, legacy: &b.legacy_names, icon: shortcut_icon().clone() }
}

const ICON: &[u8] = include_bytes!("../icons/icon.ico");

/// ショートカットが指すアイコン: 作業場所の icon\<絵の指紋>.ico（絵が変わると場所も変わり、Windows が古い絵を出し続けない）。
fn shortcut_icon() -> &'static PathBuf {
    static I: OnceLock<PathBuf> = OnceLock::new();
    I.get_or_init(|| {
        let p = Paths::new(&locate::local_root());
        install::icon_file(&p, ICON).unwrap_or_else(|e| {
            log(&format!("SHORTCUT アイコンを書き出せません（exe の絵を使います）: {e}"));
            p.app().join(&brand().exe)
        })
    })
}

/// 入口（この PC の app の exe）で開き直して、この窓を閉じる。
fn relaunch(app: &AppHandle, paths: &Paths) -> Result<(), String> {
    let entry = paths.app().join(&brand().exe);
    std::process::Command::new(&entry)
        .args(["--wait-pid", &std::process::id().to_string()])
        .current_dir(paths.app())
        .spawn()
        .map_err(|e| format!("開き直せません（{}）: {e}", entry.display()))?;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_DELAY);
        log("EXIT 開き直す（入口へ渡した）");
        app.exit(0);
    });
    Ok(())
}

/// 保存（ダウンロード）の記録。自己診断のとき /__desktop/downloads が返す。
fn downloads() -> &'static Mutex<Vec<serde_json::Value>> {
    static D: OnceLock<Mutex<Vec<serde_json::Value>>> = OnceLock::new();
    D.get_or_init(Mutex::default)
}

/// 画面が開けた（/__desktop/ready）ときにすること: 入れ替えた直後の印を消し、ショートカットを直し、古い写しを片付ける。
struct Ready {
    done: AtomicBool,
    installed: bool,
    paths: Paths,
}

impl Ready {
    fn mark(&self) {
        if self.done.swap(true, Ordering::SeqCst) || !self.installed {
            return;
        }
        update::confirm(&self.paths);
        let p = self.paths.clone();
        std::thread::spawn(move || {
            for f in install::maintain(&p, &lnk::places(), &lnk::pinned(), &lnk::OsLinks, &names()) {
                log(&format!("SHORTCUT {f}"));
            }
            if let Ok(me) = std::env::current_exe() {
                update::cleanup_copies(&p, &me);
            }
        });
    }
}

/// 窓そのものが答える問い合わせ（終了・窓の情報・更新・配布・ショートカット・自己診断）。
fn native(app: AppHandle, info: serde_json::Value, upd: Arc<Updater>, ready: Arc<Ready>) -> Native {
    let query_of = |q: &str, k: &str| dt_core::app::parse_query(q).into_iter().find(|(a, _)| a == k).map(|(_, v)| v).unwrap_or_default();
    Box::new(move |method, path, query, body| {
        let settings = || updater::settings_of(&Config::load(None, &locate::local_root()));
        let v: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
        Some(match (method, path) {
            ("POST", "/__desktop/shutdown") => {
                let app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(QUIT_DELAY);
                    log("EXIT 画面の終了");
                    app.exit(0);
                });
                json_reply(&json!({"ok": true}))
            }
            ("POST", "/__desktop/ready") => {
                ready.mark();
                json_reply(&json!({"ok": true}))
            }
            ("GET", "/__desktop/info") => json_reply(&info),
            ("GET", "/__desktop/update") => json_reply(&upd.status()),
            ("POST", "/__desktop/update/check") => {
                upd.wake();
                json_reply(&json!({"ok": true}))
            }
            ("POST", "/__desktop/update/probe") => json_reply(&Updater::probe(v["value"].as_str().unwrap_or(""))),
            ("POST", "/__desktop/update/apply") => {
                if upd.status()["state"] != "ready" || !upd.installed {
                    return Some(Reply::error(409, "開き直して入れ替える版がありません。"));
                }
                log(&format!("UPDATE 開き直して {} にします", upd.status()["ready"]));
                reply_of(relaunch(&app, &upd.paths).map(|_| json!({"ok": true})).map_err(|e| (500, e)))
            }
            ("GET", "/__desktop/install") => {
                json_reply(&install::status(&upd.paths, &lnk::places(), &lnk::OsLinks, &names(), upd.installed))
            }
            ("POST", "/__desktop/shortcut") => {
                let r = install::make(&upd.paths, &lnk::places(), &lnk::OsLinks, &names());
                match &r {
                    Ok(v) => log(&format!("SHORTCUT 作る: 作った {} / 作れない {}", v["made"], v["problems"])),
                    Err(e) => log(&format!("SHORTCUT 作れない: {e}")),
                }
                reply_of(r.map_err(|e| (400, e)))
            }
            ("POST", "/__desktop/shortcut/decline") => reply_of(install::decline(&upd.paths).map_err(|e| (500, e))),
            ("GET", "/__desktop/release") => json_reply(&upd.release_view(&settings(), query_of(query, "cached") == "1")),
            ("GET", "/__desktop/release/progress") => json_reply(&upd.place_progress()),
            ("POST", "/__desktop/release/place") => reply_of(upd.place(&settings(), &query_of(query, "name"), body).map(|r| {
                upd.wake();
                json!({"version": r["version"], "bytes": r["bytes"]})
            })),
            ("POST", "/__desktop/release/distribute") => reply_of(upd.distribute(&settings(), v["version"].as_str().unwrap_or(""))),
            ("POST", "/__desktop/release/recommend") => reply_of(upd.set_recommended(
                &settings(),
                v["version"].as_str().unwrap_or(""),
                v["on"] == true,
                v["note"].as_str().unwrap_or(""),
            )),
            ("POST", "/__desktop/release/remove") => reply_of(upd.remove(&settings(), v["version"].as_str().unwrap_or(""))),
            // 書き出したファイルの入ったフォルダを開き、そのファイルを選んだ状態にする
            ("POST", "/__desktop/reveal") => {
                use tauri_plugin_opener::OpenerExt;
                let p = v["path"].as_str().unwrap_or("");
                if p.is_empty() || !Path::new(p).exists() {
                    return Some(Reply::error(404, "そのファイルが見つかりません（移したか消したかもしれません）。"));
                }
                match app.opener().reveal_item_in_dir(p) {
                    Ok(()) => json_reply(&json!({"ok": true})),
                    Err(e) => Reply::error(500, &e.to_string()),
                }
            }
            ("GET", "/__desktop/downloads") => json_reply(&json!(downloads().lock().map(|v| v.clone()).unwrap_or_default())),
            ("POST", "/__desktop/selftest") => {
                let mut result = v.clone();
                if result.is_null() {
                    result = json!({"ok": false, "error": "自己診断の結果を読めません"});
                }
                selftest_finish(&app, &result);
                json_reply(&json!({"received": true}))
            }
            _ => return None,
        })
    })
}

fn window(app: &AppHandle, label: &str, url: WebviewUrl, splash: Arc<Splash>) -> tauri::Result<WebviewWindow> {
    let (handle, nav) = (app.clone(), app.clone());
    let b = brand();
    let builder = WebviewWindowBuilder::new(app, label, url)
        .title(format!("{} — {}", b.name, b.subtitle))
        .inner_size(1600.0, 1000.0)
        .min_inner_size(1100.0, 700.0)
        .maximized(label == "main")
        .background_color(tauri::window::Color(0x1c, 0x35, 0x50, 0xff))
        // 窓のファイルのドロップ受けを外す。Windows（WebView2）では、これがあると画面の中の HTML5 のドラッグ＆ドロップ
        // （データ項目を表示先へ置く・並べ替え）が届かない。ファイルのドロップは使っていない
        .disable_drag_drop_handler()
        .on_navigation(move |u| {
            let inside = is_app_url(u) || is_splash(u) || matches!(u.scheme(), "about" | "blob" | "data");
            if !inside {
                open_outside(&nav, u);
            }
            inside
        })
        .on_new_window(move |u, _features| {
            open_outside(&handle, &u);
            NewWindowResponse::Deny
        })
        .on_page_load(move |w, p| {
            if p.event() != PageLoadEvent::Finished {
                return;
            }
            if is_splash(p.url()) {
                splash.flush(&w);
            } else if is_app_url(p.url()) && p.url().path() == "/" && selftest_on() {
                let _ = w.eval(SELFTEST_JS);
            }
        })
        .on_download(|wv, ev| on_download(&wv, ev));
    let builder = if selftest_on() { builder.initialization_script(ERROR_WATCH_JS) } else { builder };
    builder.build()
}

/// http・https・mailto だけをいつものブラウザで開く（file: などは開かない）。
fn open_outside(app: &AppHandle, u: &Url) {
    if matches!(u.scheme(), "http" | "https" | "mailto") {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(u.as_str(), None::<&str>);
    }
}

/// 保存（CSV など）が済んだら、置いた場所を画面へ知らせる（dt:saved。画面が「保存しました・フォルダを開く」を出す）。
fn on_download<R: tauri::Runtime>(wv: &tauri::Webview<R>, ev: DownloadEvent<'_>) -> bool {
    if let DownloadEvent::Finished { path, success, url } = &ev {
        let detail = json!({"path": path.as_ref().map(|p| p.display().to_string()), "ok": *success});
        let _ = wv.eval(format!("window.dispatchEvent(new CustomEvent('dt:saved', {{detail: {detail}}}))"));
        if selftest_on() {
            let body = path.as_ref().and_then(|p| std::fs::read(p).ok()).unwrap_or_default();
            let head: String = body.iter().take(4).map(|b| format!("{b:02x}")).collect();
            let row = json!({"state": "finished", "url": url.as_str(), "path": path.as_ref().map(|p| p.display().to_string()), "success": success,
                             "bytes": body.len(), "head": head});
            log(&format!("DOWNLOAD {row}"));
            downloads().lock().unwrap().push(row);
        }
    }
    true
}

/// 起動の最初に置き場を確かめるとき、置き場に届くのを待つ長さ（過ぎたら待たずに開き、裏の確かめに任せる）。
const LAUNCH_CHECK_WAIT: Duration = Duration::from_secs(8);

fn launch_update(app: &AppHandle, splash: &Splash, paths: &Paths, notes: &mut Vec<String>) {
    let source = updater::source_with_entry(paths, &update::remembered_source(paths).unwrap_or_default());
    if source.trim().is_empty() {
        return;
    }
    let current = update::program_version(&paths.app().join("program")).unwrap_or_default();
    splash.step(app, "update", "now", "新しい版が配られていないか確かめています…");
    let progress = |t: &str| splash.step(app, "update", "now", &format!("{t}…"));
    match update::launch_check(paths, &source, &brand().app_id, &current, LAUNCH_CHECK_WAIT, &progress) {
        update::Launch::Staged(v) => log(&format!("UPDATE 起動の最初に版 {v} を取り込みました")),
        update::Launch::Nothing(why) => log(&format!("UPDATE 起動の最初の確かめ: {why}")),
        update::Launch::Slow => log(&format!("UPDATE 置き場に {} 秒で届かないので、裏で確かめます", LAUNCH_CHECK_WAIT.as_secs())),
        update::Launch::Failed(e) => {
            log(&format!("UPDATE 起動の最初の確かめ: {e}"));
            notes.push(format!("{e}（使っている間に、もう一度試します）"));
        }
    }
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// 窓の中で（起動画面に段を出しながら）する、この PC へ写す仕事。
#[derive(Debug)]
enum Job {
    /// 共有・BOX・展開したフォルダの配る形をこの PC の app へ写す
    Localize(PathBuf),
    /// 配る入口（置き場のアプリのフォルダ）から、配る版を取り込んで app に据える
    Entry(PathBuf),
}

fn job() -> &'static OnceLock<Job> {
    static J: OnceLock<Job> = OnceLock::new();
    &J
}

fn spawn_entry(paths: &Paths) -> Result<(), String> {
    let entry = paths.app().join(&brand().exe);
    std::process::Command::new(&entry)
        .args(["--wait-pid", &std::process::id().to_string()])
        .current_dir(paths.app())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("この PC のアプリを開けません（{}）: {e}", entry.display()))
}

/// 写す・取り込む。済めば入口を開いて窓を閉じ true。
fn run_job(app: &AppHandle, splash: &Splash, job: &Job) -> bool {
    let b = brand();
    let paths = Paths::new(&locate::local_root());
    let result = match job {
        Job::Localize(dist) => {
            let version = update::validate_dist(dist, &b.exe, &b.app_id, None).unwrap_or_default();
            if !update::should_localize(&paths, &version) {
                Ok(format!("この PC のアプリ（{}）で開きます", paths.app().display()))
            } else {
                splash.step(app, "program", "now", &format!("この PC へ写しています（{} → {}）…", dist.display(), paths.app().display()));
                update::localize(&paths, dist, &b.exe, &b.app_id).map(|v| {
                    log(&format!("INSTALL {} からこの PC へ写しました（版 {v}）", dist.display()));
                    format!("版 {v} をこの PC へ写しました")
                })
            }
        }
        Job::Entry(folder) => {
            splash.step(app, "program", "now", &format!("配る版を確かめています（{}）…", folder.display()));
            let (a, s) = (app.clone(), splash);
            dt_core::distribute::install_from_entry(&paths, folder, &b.app_id, &|t| s.step(&a, "program", "now", t)).map(|v| {
                log(&format!("INSTALL 配る入口（{}）から版 {v} をこの PC へ据えました", folder.display()));
                format!("配る版 {v} をこの PC へ写しました")
            })
        }
    };
    match result {
        Ok(text) => {
            splash.step(app, "program", "ok", &text);
            splash.step(app, "open", "now", "この PC のアプリで開いています…");
            match spawn_entry(&paths) {
                Ok(()) => {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(QUIT_DELAY);
                        app.exit(0);
                    });
                }
                Err(e) => splash.fail(app, "この PC のアプリを開けません", &e),
            }
            true
        }
        Err(e) if matches!(job, Job::Localize(_)) => {
            log(&format!("INSTALL この PC へ写せないので、共有のまま開きます: {e}"));
            false
        }
        Err(e) => {
            splash.fail(app, "配る版を取り込めません", &e);
            true
        }
    }
}

/// 起動して画面を開く（裏の糸で。窓は先に出しておく）。
fn start(app: AppHandle, slot: Arc<OnceLock<Router>>, splash: Arc<Splash>) {
    if let Some(j) = job().get() {
        if run_job(&app, &splash, j) {
            return;
        }
    }
    let program = match locate::program_dir() {
        Ok(p) => p,
        Err(e) => return splash.fail(&app, "アプリの中身が見つかりません", &e),
    };
    splash.step(&app, "program", "ok", &program.display().to_string());
    let paths = Paths::new(&locate::local_root());
    let installed = same_dir(&program, &paths.app().join("program"));
    let mut notes = vec![];
    let mut applied = false;
    if installed {
        launch_update(&app, &splash, &paths, &mut notes);
        match update::apply_staged(&paths, &brand().exe) {
            Ok(Some(a)) => {
                applied = true;
                log(&format!("UPDATE {} → {} に入れ替えました", a.from, a.to));
                splash.step(&app, "update", "ok", &format!("版 {} → {} に入れ替えました", a.from, a.to));
                if a.exe_changed {
                    splash.step(&app, "open", "now", "窓も新しくなったので、開き直しています…");
                    if relaunch(&app, &paths).is_ok() {
                        return;
                    }
                }
            }
            Ok(None) => applied = paths.applied().is_file(),
            Err(e) => {
                log(&format!("UPDATE 入れ替えられません: {e}"));
                notes.push(format!("新しい版に入れ替えられませんでした（次に開いたときにもう一度試します）: {e}"));
            }
        }
    }
    let version = update::program_version(&program).unwrap_or_else(|| "?".into());
    splash.say(&app, format!("splash.version(...{})", json!([version])));
    splash.step(&app, "update", "ok", if installed { "この PC のアプリ" } else { "この PC へ写さずに開いています（開発の形）" });
    let t0 = Instant::now();
    let cfg = Config::load(Some(&program.join("config").join("config.json")), &locate::local_root());
    let dt = App::new(cfg, Some(program.clone()));
    let upd = Updater::new(paths.clone(), installed, version.clone(), notes);
    let ready = Arc::new(Ready { done: AtomicBool::new(false), installed, paths: paths.clone() });
    let info = json!({
        "shell": "tauri", "app_id": brand().app_id, "name": brand().name, "shell_version": env!("CARGO_PKG_VERSION"), "commit": env!("DT_BUILD_COMMIT"),
        "version": version, "program": program, "local_root": locate::local_root(), "exe": std::env::current_exe().unwrap_or_default(),
        "installed": installed, "app": paths.app(), "url": app_url("/").as_str(), "workers": dt.cfg.workers(),
        "testLinks": std::env::var_os("DT_LINK_DIRS").is_some(),
    });
    let _ = slot.set(Router {
        app: dt.clone(),
        static_dir: program.join("app").join("static"),
        version: version.clone(),
        native: native(app.clone(), info, upd.clone(), ready.clone()),
    });
    // 入れ替えた直後の版: 画面が開けたと言わなければ、前の版へ戻して開き直す
    if installed && applied {
        let (app2, paths2, ready2) = (app.clone(), paths.clone(), ready.clone());
        std::thread::spawn(move || {
            let end = Instant::now() + READY_LIMIT;
            while Instant::now() < end && !ready2.done.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(200));
            }
            if ready2.done.load(Ordering::SeqCst) {
                return;
            }
            if let Some(back) = update::revert(&paths2) {
                log(&format!("UPDATE 版 {} の画面が {} 秒で開けないので {} に戻しました", back.from, READY_LIMIT.as_secs(), back.to));
                let _ = relaunch(&app2, &paths2);
            }
        });
    }
    let cfg_path = locate::local_root();
    upd.run(move || Ok(updater::settings_of(&Config::load(None, &cfg_path))), log);
    log(&format!("READY version={version} program={} elapsed_ms={}", program.display(), t0.elapsed().as_millis()));
    splash.step(&app, "open", "now", "画面を開いています…");
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(app_url("/"));
    }
}

fn arg_u32(name: &str) -> Option<u32> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok())
}

/// 開発の作業ツリー（program の隣に .git）・引き継がない指定（--here・DT_NO_HANDOFF）。この PC へ写さず、そのまま動く。
fn dev_mode() -> bool {
    std::env::args().any(|a| a == "--here")
        || std::env::var_os("DT_NO_HANDOFF").is_some()
        || locate::program_dir().is_ok_and(|p| p.parent().is_some_and(|r| r.join(".git").exists()))
}

/// 起動のはじめ（窓を作る前）: 入口なら版ごとの写しへ渡す。共有などの配る形・配る入口は、窓の中で写す仕事を決める。→ 渡したら true
fn hand_off() -> bool {
    if let Some(pid) = arg_u32("--wait-pid") {
        proc::wait_gone(pid, Duration::from_secs(30));
    }
    let Ok(me) = std::env::current_exe() else { return false };
    let b = brand();
    let paths = Paths::new(&locate::local_root());
    if !dev_mode() {
        if let Some(folder) = dt_core::distribute::entry_folder(&me, &b.app_id) {
            let _ = job().set(Job::Entry(folder));
            return false;
        }
    }
    let pid = std::process::id().to_string();
    match update::plan(&paths, &me, &b.exe, dev_mode()) {
        update::Step::Stay => false,
        update::Step::Handoff => match update::copy_for_run(&paths, &me) {
            Ok(copy) => {
                let program = paths.app().join("program").display().to_string();
                std::process::Command::new(&copy)
                    .args(["--program".to_string(), program, "--wait-pid".into(), pid])
                    .current_dir(copy.parent().unwrap_or(Path::new(".")))
                    .spawn()
                    .is_ok()
            }
            Err(e) => {
                log(&format!("START 版ごとの写しを作れないので、入口のまま開きます: {e}"));
                false
            }
        },
        update::Step::Localize(dist) => {
            let _ = job().set(Job::Localize(dist));
            false
        }
    }
}

fn main() {
    if hand_off() {
        return;
    }
    let slot: Arc<OnceLock<Router>> = Arc::default();
    let splash: Arc<Splash> = Arc::default();
    let proto_slot = slot.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        // 画面からの問い合わせ（dt）。1 つずつ別の糸で答える（長い問い合わせが画面を止めない）
        .register_asynchronous_uri_scheme_protocol(SCHEME, move |_ctx, req, responder| {
            let slot = proto_slot.clone();
            std::thread::spawn(move || {
                let resp = match slot.get() {
                    Some(r) => r.handle(&req),
                    None => to_response(Reply::error(503, "起動中です。")),
                };
                responder.respond(resp);
            });
        })
        .setup({
            let (slot, splash) = (slot.clone(), splash.clone());
            move |app| {
                let handle = app.handle().clone();
                window(&handle, "main", WebviewUrl::App("index.html".into()), splash.clone())?;
                splash.say(&handle, format!("splash.brand(...{})", json!([brand().name, brand().subtitle])));
                if selftest_on() {
                    let h = handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(SELFTEST_LIMIT);
                        selftest_finish(&h, &json!({"ok": false, "error": format!("{} 秒で終わりませんでした", SELFTEST_LIMIT.as_secs())}));
                    });
                }
                std::thread::spawn(move || start(handle, slot, splash));
                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("起動できません");
    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            log("EXIT 窓を閉じた");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_of_the_app_and_the_splash() {
        assert!(is_app_url(&app_url("/api/pins")));
        assert!(is_app_url(&Url::parse("http://dt.localhost/x").unwrap()), "Windows（WebView2）の形");
        assert!(is_app_url(&Url::parse("dt://localhost/x").unwrap()), "ほかの OS の形");
        assert!(!is_app_url(&Url::parse("http://example.com/").unwrap()));
        assert!(!is_app_url(&Url::parse("file://dt.localhost/x").unwrap()), "file: はアプリの中ではない");
        assert!(is_splash(&Url::parse("tauri://localhost/index.html").unwrap()));
    }

    /// Windows の窓では、ファイルのドロップ受けがあると画面の中のドラッグ＆ドロップが届かない（版 4.5.0 までの不具合）。
    /// 窓の作り方（Windows でしか確かめられない）から外れていないかを、作り方の文で確かめる
    #[test]
    fn the_window_leaves_drag_and_drop_to_the_page() {
        let src = include_str!("main.rs");
        let body = &src[src.find("fn window(").unwrap()..src.find("fn open_outside(").unwrap()];
        assert!(body.contains(".disable_drag_drop_handler()"));
    }
}
