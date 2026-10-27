//! 窓の更新の係（裏の糸と画面への答え）。取り込み・入れ替えの中身は dt_core::update、置き場の探し方は dt_core::release。
//!
//! - 確かめる: 画面が開いた直後・30 分ごと・画面の「確かめる」
//! - 置き場は設定（作業場所の config.json の update_source）。配る入口から入れた PC は、控えた入口の置き場も後ろの候補にする
//! - 配る版が決まっていればその版（前の版へ戻すときも）、決まっていなければいちばん新しい版を、使っている間に取り込む（決め方は update::pick）
//! - 置き場を控える（update::remember_source）。次の起動の最初に、画面を開く前にも確かめる（起動していない間に配った版を 1 回の起動で入れる）
//! - 画面: GET /__desktop/update（状態）・POST /__desktop/update/check・POST /__desktop/update/apply（開き直す）・
//!   POST /__desktop/update/probe（置き場の「確かめる」: この PC での見え方で置き場を探す）
//! - 配布の画面（GET /__desktop/release）は、置き場をたどった結果を覚える。cached=1 なら覚えた結果をすぐ返し（cachedAt つき）、
//!   画面は裏で cached なしを尋ねて確かめ直す（同期フォルダの置き場をたどるのは遅い）

use dt_core::brand::brand;
use dt_core::distribute::{self, Who};
use dt_core::release;
use dt_core::update::{self, Paths};
use serde_json::{json, Map, Value};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// 確かめる間隔。
const EVERY: Duration = Duration::from_secs(30 * 60);

pub struct Updater {
    pub paths: Paths,
    /// この PC のアプリ（app）で動いているか。開発の作業ツリー・共有から動くときは取り込まない
    pub installed: bool,
    /// いま動いている中身の版
    pub current: String,
    state: Mutex<Map<String, Value>>,
    wake: (Mutex<bool>, Condvar),
    /// 版を置いている最中の進み具合（1 台で同時に置けるのは 1 本）
    placing: Mutex<Option<Value>>,
    /// 配布の画面の答えの覚え（置き場の設定, 答え（me なし）, たどった時刻）
    view_cache: Mutex<Option<(String, Value, String)>>,
}

/// 置き場の設定（参照先 update.source）に、配る入口から入れた PC が控えた置き場を後ろの候補として足す。
pub fn source_with_entry(paths: &Paths, source: &str) -> String {
    match distribute::remembered_entry(paths) {
        Some(dir) if !source.contains(&*dir.to_string_lossy()) => {
            if source.trim().is_empty() {
                dir.display().to_string()
            } else {
                format!("{source};{}", dir.display())
            }
        }
        _ => source.to_string(),
    }
}

/// 配布の画面の答えに、だれか（me）と、覚えた答えなら いつたどった物か（cachedAt）を入れる。
fn with_me(mut v: Value, me: Value, cached_at: Option<&str>) -> Value {
    v["me"] = me;
    v["cached"] = json!(cached_at.is_some());
    v["checkedAt"] = json!(cached_at.map(str::to_string).unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()));
    v
}

/// 更新の置き場の設定と、だれか（Windows のログイン名・PC の名前・版を置いてよいか）。
/// 置いてよいのは、設定の release_users が空ならだれでも（置き場へ書ける人）、あればそこに名前がある人だけ。
pub fn settings_of(cfg: &dt_core::config::Config) -> Value {
    let env = |k: &str| std::env::var(k).unwrap_or_default();
    let login = if cfg!(windows) { env("USERNAME") } else { env("USER") };
    let pc = if cfg!(windows) { env("COMPUTERNAME") } else { env("HOSTNAME") };
    let users = cfg.strs("release_users");
    let can = users.is_empty() || users.iter().any(|u| u.eq_ignore_ascii_case(&login));
    json!({"source": cfg.update_source(), "who": {"login": login, "pc": pc, "canRelease": can, "users": users}})
}

fn who_of(settings: &Value) -> Who {
    Who { login: settings["who"]["login"].as_str().unwrap_or("").into(), pc: settings["who"]["pc"].as_str().unwrap_or("").into() }
}

impl Updater {
    pub fn new(paths: Paths, installed: bool, current: String, notes: Vec<String>) -> Arc<Updater> {
        let mut st = Map::new();
        st.insert("state".into(), json!(if installed { "idle" } else { "off" }));
        st.insert("current".into(), json!(current));
        st.insert("notes".into(), json!(notes));
        if !installed {
            st.insert("detail".into(), json!("この PC のアプリ（作業場所の app）で動いていないので、更新は取り込みません"));
        }
        Arc::new(Updater {
            paths,
            installed,
            current,
            state: Mutex::new(st),
            wake: (Mutex::new(false), Condvar::new()),
            placing: Mutex::new(None),
            view_cache: Mutex::new(None),
        })
    }

    /// 画面へ（GET /__desktop/update）。
    pub fn status(&self) -> Value {
        let mut s = self.state.lock().unwrap().clone();
        s.insert("failed".into(), json!(update::failed_versions(&self.paths)));
        Value::Object(s)
    }

    fn set(&self, pairs: Value) {
        let mut s = self.state.lock().unwrap();
        for k in ["ready", "direction", "detail", "problem"] {
            s.remove(k);
        }
        if let Value::Object(m) = pairs {
            s.extend(m);
        }
    }

    /// すぐ確かめる（画面の「確かめる」・置き場の保存）。
    pub fn wake(&self) {
        *self.wake.0.lock().unwrap() = true;
        self.wake.1.notify_all();
    }

    /// 裏の糸: 確かめて、間隔を空けて繰り返す。ask は置き場の設定（config.json）を読み直す。
    pub fn run(self: &Arc<Self>, ask: impl Fn() -> Result<Value, String> + Send + 'static, log: fn(&str)) {
        if !self.installed {
            return;
        }
        let me = self.clone();
        std::thread::spawn(move || loop {
            me.check(&ask, log);
            let (m, cv) = (&me.wake.0, &me.wake.1);
            let g = m.lock().unwrap();
            let (mut g, _) = cv.wait_timeout_while(g, EVERY, |w| !*w).unwrap();
            *g = false;
        });
    }

    /// 1 回確かめる（取り込みまで）。
    pub fn check(&self, ask: &dyn Fn() -> Result<Value, String>, log: fn(&str)) {
        let b = brand();
        self.set(json!({"state": "checking"}));
        let settings = match ask() {
            Ok(v) => v,
            Err(e) => return self.set(json!({"state": "error", "problem": format!("更新の置き場の設定を読めません: {e}")})),
        };
        let source = source_with_entry(&self.paths, settings["source"].as_str().unwrap_or(""));
        let checked = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        {
            let mut s = self.state.lock().unwrap();
            s.insert("source".into(), json!(source));
            s.insert("checkedAt".into(), json!(checked));
        }
        // 起動の最初（中身を起こす前）にも同じ置き場を確かめられるよう、控える（update::launch_check）
        update::remember_source(&self.paths, &source);
        if source.trim().is_empty() {
            let _ = std::fs::remove_file(self.paths.want());
            return self.set(json!({"state": "off"}));
        }
        let (found, adjusted) = match release::locate_source(&source) {
            Ok(f) => f,
            Err(e) => return self.set(json!({"state": "error", "problem": e})),
        };
        let scan = release::scan(&found, &b.app_id);
        self.remember_view(&source, distribute::view_of(&scan, &found, adjusted, &source, &b.name, Value::Null));
        {
            let mut s = self.state.lock().unwrap();
            s.insert("found".into(), json!(found.display().to_string()));
            s.insert("adjusted".into(), json!(adjusted));
            s.insert("distributed".into(), scan.distribute.as_ref().map(|d| d.raw.clone()).unwrap_or(Value::Null));
        }
        // 配る版（画面が「最新版か」を出すのに使う）。決まっていなければ消す
        match &scan.distribute {
            Some(d) => {
                let _ = update::write_json(&self.paths.want(), &d.raw);
            }
            None => {
                let _ = std::fs::remove_file(self.paths.want());
            }
        }
        let (target, direction) = match update::pick(&scan, &update::failed_versions(&self.paths), &self.current) {
            update::Pick::Take(t, d) => (t, d),
            update::Pick::Stay(why) => {
                // いまの版が最新なら、取り込みかけの別の版は捨てる（配る版が戻された等）
                if why.is_none() && update::staged(&self.paths).is_some() {
                    let _ = std::fs::remove_dir_all(self.paths.stage());
                    let _ = std::fs::remove_file(self.paths.stage_record());
                }
                return self.set(match why {
                    Some(w) => json!({"state": "latest", "detail": w}),
                    None => json!({"state": "latest"}),
                });
            }
        };
        if update::staged(&self.paths).is_some_and(|s| s["version"] == json!(target.version)) {
            return self.set(json!({"state": "ready", "ready": target.version, "direction": direction}));
        }
        self.set(json!({"state": "staging", "detail": target.version}));
        let progress = |_t: &str| {};
        match update::stage_release(&self.paths, target, &b.app_id, &progress) {
            Ok(_) => {
                log(&format!("UPDATE 版 {} を取り込みました（{}）", target.version, target.zip_path().display()));
                self.set(json!({"state": "ready", "ready": target.version, "direction": direction}));
            }
            Err(e) => {
                log(&format!("UPDATE 版 {} を取り込めません: {e}", target.version));
                self.set(json!({"state": "error", "problem": format!("版 {} を取り込めません: {e}", target.version)}));
            }
        }
    }

    /// 配布の画面（GET /__desktop/release）。settings は置き場と、だれか（settings_of）。
    pub fn release_view(&self, settings: &Value, cached: bool) -> Value {
        let b = brand();
        let who = &settings["who"];
        let me = json!({"canRelease": who["canRelease"] == true, "users": who["users"], "login": who["login"], "pc": who["pc"],
                        "current": self.current});
        let source = source_with_entry(&self.paths, settings["source"].as_str().unwrap_or(""));
        if cached {
            if let Some((src, v, at)) = self.view_cache.lock().unwrap().clone() {
                if src == source {
                    return with_me(v, me, Some(&at));
                }
            }
        }
        let v = match release::locate_source(&source) {
            Ok((found, adjusted)) => distribute::view(&found, adjusted, &source, &b.app_id, &b.name, Value::Null),
            Err(e) => json!({"reachable": false, "why": e, "folder": source, "found": null, "versions": []}),
        };
        self.remember_view(&source, v.clone());
        with_me(v, me, None)
    }

    /// 置き場をたどった結果を覚える（画面の答え・裏の確認のどちらがたどっても）。
    fn remember_view(&self, source: &str, v: Value) {
        let at = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        *self.view_cache.lock().unwrap() = Some((source.to_string(), v, at));
    }

    /// 置いている最中の進み具合（GET /__desktop/release/progress）。
    pub fn place_progress(&self) -> Value {
        self.placing.lock().unwrap().clone().unwrap_or_else(|| json!({"state": "idle"}))
    }

    /// 画面から選んだ ZIP（読み終えたバイト列）を置き場に置く（POST /__desktop/release/place）。→ Ok(release.json) か (状態, 理由)
    pub fn place(&self, settings: &Value, file_name: &str, body: &[u8]) -> Result<Value, (u16, String)> {
        let b = brand();
        if settings["who"]["canRelease"] != true {
            return Err((403, "版を置けるのは、設定（config.json）の release_users に名前がある人だけです。".into()));
        }
        let (found, _) = release::locate_source(settings["source"].as_str().unwrap_or("")).map_err(|e| (400, e))?;
        {
            let mut g = self.placing.lock().unwrap();
            if g.as_ref().is_some_and(|v| v["state"] == "running") {
                return Err((409, "ほかの版を置いている最中です。終わってからもう一度選んでください。".into()));
            }
            *g = Some(json!({"state": "running", "stage": "check", "done": 0, "total": 0, "elapsed": 0.0}));
        }
        let t0 = std::time::Instant::now();
        let dl = self.paths.work().join(format!("place-{}.zip", std::process::id()));
        let result = (|| {
            std::fs::create_dir_all(self.paths.work()).map_err(|e| e.to_string())?;
            std::fs::write(&dl, body).map_err(|e| format!("受け取った ZIP を書けません: {e}"))?;
            let progress = |stage: &str, done: u64, total: u64| {
                *self.placing.lock().unwrap() = Some(json!({"state": "running", "stage": stage, "done": done, "total": total,
                                                             "elapsed": t0.elapsed().as_secs_f64()}));
            };
            distribute::place(&self.paths, &found, &dl, file_name, &b.app_id, &who_of(settings), &progress)
        })();
        let _ = std::fs::remove_file(&dl);
        let state = if result.is_ok() { "done" } else { "failed" };
        *self.placing.lock().unwrap() = Some(json!({"state": state, "elapsed": t0.elapsed().as_secs_f64()}));
        result.map_err(|e| (400, e))
    }

    /// 配る版を決める（POST /__desktop/release/distribute）。
    pub fn distribute(&self, settings: &Value, version: &str) -> Result<Value, (u16, String)> {
        if settings["who"]["canRelease"] != true {
            return Err((403, "配る版を決められるのは、設定（config.json）の release_users に名前がある人だけです。".into()));
        }
        let (found, _) = release::locate_source(settings["source"].as_str().unwrap_or("")).map_err(|e| (400, e))?;
        let r = distribute::set_distributed(&found, version, &brand().app_id, &who_of(settings)).map_err(|e| (400, e))?;
        self.wake();
        Ok(r)
    }

    /// 推奨アップデートの札を付ける・外す（POST /__desktop/release/recommend {version, on, note}）
    pub fn set_recommended(&self, settings: &Value, version: &str, on: bool, note: &str) -> Result<Value, (u16, String)> {
        if settings["who"]["canRelease"] != true {
            return Err((403, "推奨の札を付けられるのは、設定（config.json）の release_users に名前がある人だけです。".into()));
        }
        let (found, _) = release::locate_source(settings["source"].as_str().unwrap_or("")).map_err(|e| (400, e))?;
        let r = distribute::set_recommended(&found, &brand().app_id, version, on, note, &who_of(settings)).map_err(|e| (400, e))?;
        self.wake();
        Ok(r)
    }

    /// 置いた版を消す（POST /__desktop/release/remove）。配っている版は消さない。
    pub fn remove(&self, settings: &Value, version: &str) -> Result<Value, (u16, String)> {
        if settings["who"]["canRelease"] != true {
            return Err((403, "版を消せるのは、設定（config.json）の release_users に名前がある人だけです。".into()));
        }
        let (found, _) = release::locate_source(settings["source"].as_str().unwrap_or("")).map_err(|e| (400, e))?;
        let r = distribute::remove_version(&found, version, &brand().app_id).map_err(|e| (400, e))?;
        self.wake();
        Ok(r)
    }

    /// 参照先の「確かめる」（この PC での見え方で探し、見つけた版を言う）。
    pub fn probe(value: &str) -> Value {
        let b = brand();
        let (found, adjusted) = match release::locate_source(value) {
            Ok(f) => f,
            Err(e) => return json!({"ok": false, "message": e}),
        };
        let scan = release::scan(&found, &b.app_id);
        let vers: Vec<String> = scan.by_version().iter().map(|r| r.version.clone()).collect();
        let adj = if adjusted { "（この PC での見え方に合わせて探しました）" } else { "" };
        let dist = scan.distribute.as_ref().map(|d| format!("・配る版 {}", d.version)).unwrap_or_default();
        let problems = if scan.problems.is_empty() { String::new() } else { format!("。読めない物: {}", scan.problems.join("・")) };
        if vers.is_empty() {
            return json!({"ok": true, "message": format!("置き場 {}{adj} に届きました。このアプリの版はまだ置いてありません{problems}", found.display())});
        }
        json!({"ok": true, "message": format!("置き場 {}{adj} に届きました。版 {} 個（いちばん新しい版 {}）{dist}{problems}",
            found.display(), vers.len(), vers[0])})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 置き場に版を 1 つ置く（release.json だけ。配布の画面は中身の ZIP を開かない）
    fn put(dir: &std::path::Path, version: &str) {
        let d = dir.join("App").join(version);
        std::fs::create_dir_all(&d).unwrap();
        let rel = json!({"schema": 1, "app_id": brand().app_id, "name": "App", "version": version, "zip": format!("App-{version}.zip"),
                         "sha256": "a".repeat(64), "exe": "App.exe", "bytes": 10});
        std::fs::write(d.join(release::MARKER), serde_json::to_vec(&rel).unwrap()).unwrap();
    }

    #[test]
    fn release_view_answers_from_memory_when_asked_and_rescans_otherwise() {
        let d = std::env::temp_dir().join(format!("da-updater-view-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let rels = d.join("Releases");
        put(&rels, "3.1.0");
        let upd = Updater::new(Paths::new(&d.join("local")), false, "3.1.0".into(), vec![]);
        let settings = json!({"source": rels.display().to_string(), "who": {"canRelease": true, "login": "u", "pc": "PC"}});
        let n = |v: &Value| v["versions"].as_array().map(Vec::len).unwrap_or(0);

        let first = upd.release_view(&settings, true);
        assert_eq!((n(&first), first["cached"].as_bool()), (1, Some(false)), "覚えが無ければたどる: {first}");
        assert_eq!(first["me"]["canRelease"], true, "だれか（me）は毎回入れる");
        put(&rels, "3.2.0");
        let mem = upd.release_view(&settings, true);
        assert_eq!((n(&mem), mem["cached"].as_bool()), (1, Some(true)), "cached=1 は覚えた答え（置き場をたどらない）");
        assert_eq!(mem["checkedAt"], first["checkedAt"], "いつたどった答えかを言う");
        let fresh = upd.release_view(&settings, false);
        assert_eq!((n(&fresh), fresh["cached"].as_bool()), (2, Some(false)), "cached なしはたどり直す");
        assert_eq!(n(&upd.release_view(&settings, true)), 2, "たどり直した答えを覚える");
        let other = json!({"source": d.join("無い").display().to_string(), "who": {}});
        let v = upd.release_view(&other, true);
        assert_eq!((v["reachable"].as_bool(), v["cached"].as_bool()), (Some(false), Some(false)), "置き場が変われば覚えは使わない: {v}");
        let _ = std::fs::remove_dir_all(&d);
    }
}
