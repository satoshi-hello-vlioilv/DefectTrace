//! 画面の問い合わせに答える（版 3.8 の Flask の答えと同じ形。画面の JS は fetch("/api/…") のまま）。
//! 窓（main.rs）は Tauri の自前の仕組み（dt://）で、試しの入口（examples/serve.rs）は HTTP で、ここへ渡す。

use crate::analysis::{self, PitchCond};
use crate::cache::Lru;
use crate::config::Config;
use crate::dat::{Dat, V};
use crate::images::{self, Images};
use crate::lot::{self, fmt_num, fmt_val, glob, name_of, py_str, rec_get, rec_value, resolve_lot_pin, side_info, LotCache, LotRes};
use crate::pins::Pins;
use crate::pyfmt::{natcmp, round_to};
use crate::xml;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// 答え。
#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn json(v: &Value) -> Reply {
        Reply {
            status: 200,
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: serde_json::to_vec(v).unwrap_or_default(),
        }
    }
    pub fn error(status: u16, msg: &str) -> Reply {
        Reply { status, ..Reply::json(&json!({"error": msg})) }
    }
    pub fn bytes(ctype: &str, body: Vec<u8>, cache: &str) -> Reply {
        Reply { status: 200, headers: vec![("Content-Type".into(), ctype.into()), ("Cache-Control".into(), cache.into())], body }
    }
}

type R = Result<Reply, Reply>;

/// 覚えの上限（バイト）。木の札の値は小さく、画像と欠陥の対応は 2 万枚で数 MB
const LOTSUM_BYTES: usize = 16 << 20;
const IMGMAP_BYTES: usize = 128 << 20;

/// アプリの状態（設定・表示項目・ロットの覚え・画像の仕事）。
pub struct App {
    pub cfg: Arc<Config>,
    /// 配る物の program フォルダ（画面の static・定義の defs）
    pub program: Option<PathBuf>,
    pub pins: Pins,
    pub lots: LotCache,
    /// ロット表の値の覚え（作業場所の lotvalues.json。1 度読んだロットは読み直さない）
    pub lotstore: Arc<crate::lotstore::LotStore>,
    pub images: Arc<Images>,
    /// 木の札の値（ロットごと）・画像と欠陥の対応（ロット・画像の組ごと）。どちらも大きさに上限のある覚え（cache::Lru）
    lotsum: Lru<String, Value>,
    imgmap: Lru<(String, String), Arc<ImgMap>>,
    lot_re: Regex,
    /// 共有のフィルタの置き場（たどるのは遅い〈BOX〉ので 1 分覚える）
    shared_dir: std::sync::Mutex<Option<(std::time::Instant, Option<PathBuf>)>>,
    /// この PC の使い始め（使用状況の心拍）
    session: crate::presence::Session,
}

/// 画像 → 欠陥の対応（"cab/name" → DETECT_INFO の番号）。
#[derive(Debug, Default)]
pub struct ImgMap {
    pub map: HashMap<String, usize>,
    /// 対応を付けた順（同じ欠陥に画像が 2 枚以上あるとき、後の画像を欠陥の画像とする。版 3.8 と同じ）
    pub order: Vec<(String, usize)>,
    pub n: usize,
    pub fin: bool,
    pub info: Value,
}

impl ImgMap {
    /// メモリのだいたいの大きさ（覚えの重さ）。
    pub fn bytes(&self) -> usize {
        1024 + self.order.iter().map(|(k, _)| 2 * (k.capacity() + 64)).sum::<usize>()
    }

    pub fn rev(&self) -> HashMap<usize, String> {
        self.order.iter().map(|(k, v)| (*v, k.clone())).collect()
    }
}

/// 問い合わせの文字（a=1&b=%E3%81%82）を読む。
pub fn parse_query(q: &str) -> Vec<(String, String)> {
    q.split('&')
        .filter(|s| !s.is_empty())
        .map(|kv| {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            (unquote(k), unquote(v))
        })
        .collect()
}

pub fn unquote(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                let h = |c: u8| (c as char).to_digit(16);
                match (h(b[i + 1]), h(b[i + 2])) {
                    (Some(x), Some(y)) => {
                        out.push((x * 16 + y) as u8);
                        i += 3;
                        continue;
                    }
                    _ => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

struct Args(Vec<(String, String)>);

impl Args {
    fn get(&self, k: &str) -> Option<&str> {
        self.0.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str())
    }
    fn req(&self, k: &str) -> Result<&str, Reply> {
        self.get(k).ok_or_else(|| Reply::error(400, &format!("{k} がありません")))
    }
}

/// JSON の字の並び（無ければ空）。
fn strs(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

/// 1 つの名前か（区切り・.. を含まない）。
fn safe_part(x: &str) -> Result<&str, Reply> {
    if x.is_empty() || x == "." || x == ".." || x.contains(['/', '\\']) {
        return Err(Reply::error(400, "名前が正しくありません"));
    }
    Ok(x)
}

/// Python の float(s)（前後の空白を許す）。
fn pyfloat(s: &str) -> Option<f64> {
    let t = s.trim().to_ascii_lowercase();
    match t.as_str() {
        "inf" | "+inf" | "infinity" => Some(f64::INFINITY),
        "-inf" | "-infinity" => Some(f64::NEG_INFINITY),
        "nan" | "+nan" | "-nan" => Some(f64::NAN),
        _ => t.replace('_', "").parse().ok(),
    }
}

fn os_err(e: &std::io::Error) -> String {
    let s = e.to_string();
    match s.find(" (os error") {
        Some(i) => s[..i].to_string(),
        None => s,
    }
}

/// 共有の置き場: 設定の filters_shared_dir、無ければ 更新の置き場のアプリのフォルダ\shared。届かなければ None。
fn shared_dir_of(cfg: &Config) -> Option<PathBuf> {
    match cfg.str("filters_shared_dir") {
        s if !s.trim().is_empty() => Some(PathBuf::from(s.trim())),
        _ => crate::release::locate_source(&cfg.update_source()).ok().map(|(found, _)| {
            let name = &crate::brand::brand().name;
            let app =
                if found.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(name)) { found } else { found.join(name) };
            app.join("shared")
        }),
    }
}

impl App {
    pub fn new(cfg: Config, program: Option<PathBuf>) -> Arc<App> {
        let cfg = Arc::new(cfg);
        let lot_re = Regex::new(&cfg.str("lot_regex")).unwrap_or_else(|_| Regex::new(r"^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$").unwrap());
        // 新しい PC（pins.json が無い）だけ、表示の初期値を共有の置き場まで見に行く
        let pins = Pins::load(&cfg.home, || crate::pins::Initial { home: &cfg.home, shared: shared_dir_of(&cfg).as_deref() }.pins());
        let images = Images::new(cfg.clone());
        // 値の作り方の印: アプリの版と設定（時差・多量の名前・時刻の差の許容などで値が変わる）。設備の一覧は値に関わらないので外す
        let mut how = cfg.v.clone();
        if let Some(o) = how.as_object_mut() {
            o.remove("equipments");
        }
        let lotstore = crate::lotstore::LotStore::open(&cfg.home, &format!("{}|{how}", env!("CARGO_PKG_VERSION")));
        Arc::new(App {
            cfg,
            program,
            pins,
            lots: LotCache::default(),
            lotstore,
            images,
            lotsum: Lru::new(LOTSUM_BYTES),
            imgmap: Lru::new(IMGMAP_BYTES),
            lot_re,
            shared_dir: Default::default(),
            session: Default::default(),
        })
    }

    /// 共有の置き場（既定・共有のフィルタ・表示の初期値）。探すのは 60 秒に 1 度（shared_dir_of）。
    fn shared_dir(&self) -> Option<PathBuf> {
        let mut m = self.shared_dir.lock().unwrap();
        if let Some((at, d)) = m.as_ref() {
            if at.elapsed() < Duration::from_secs(60) {
                return d.clone();
            }
        }
        let d = shared_dir_of(&self.cfg);
        *m = Some((std::time::Instant::now(), d.clone()));
        d
    }

    fn filter_store(&self) -> crate::filters::Store {
        crate::filters::Store { home: self.cfg.home.clone(), shared: self.shared_dir() }
    }

    /// 欠陥のフィルタ: 一覧（GET）・保存（POST {scope, filter}）・消す（DELETE ?scope&id）・使える項目（GET fields?lot）・
    /// 当てる（POST apply {lot, g, filters: [...]} → 満たす欠陥の画像の名前と欠陥の番号）
    fn filters_api(&self, method: &str, path: &str, a: &Args, b: &Value) -> R {
        let who = self.cfg.who();
        let fail = |e: String| Reply::error(400, &e);
        match (method, path) {
            ("GET", "/api/filters") => {
                let mut v = self.filter_store().list();
                v["me"] = json!({"login": who.login, "developer": who.developer});
                Ok(Reply::json(&v))
            }
            ("POST", "/api/filters") => {
                let scope = b["scope"].as_str().unwrap_or("mine");
                self.filter_store().save(scope, &b["filter"], &who.login, who.developer).map(|v| Reply::json(&v)).map_err(fail)
            }
            ("DELETE", "/api/filters") => {
                self.filter_store().delete(a.req("scope")?, a.req("id")?, who.developer).map(|v| Reply::json(&v)).map_err(fail)
            }
            ("GET", "/api/filters/hist") => {
                let res = self.lotres(a.req("lot")?)?;
                Ok(Reply::json(&crate::filters::hist(&res.dat("DETECT_INFO"), a.req("field")?, 24)))
            }
            ("GET", "/api/filters/fields") => {
                let res = self.lotres(a.req("lot")?)?;
                Ok(Reply::json(&json!({"fields": crate::filters::fields(&res.dat("DETECT_INFO"))})))
            }
            ("POST", "/api/filters/apply") => {
                let (lot, g) = (b["lot"].as_str().unwrap_or(""), b["g"].as_str().unwrap_or(""));
                let fs: Vec<Value> = b["filters"].as_array().cloned().unwrap_or_default();
                let fs: Vec<Value> = fs.iter().map(crate::filters::check).collect::<Result<_, _>>().map_err(fail)?;
                let res = self.lotres(lot)?;
                let det = res.dat("DETECT_INFO");
                let pick = crate::filters::select(&det, &fs);
                let set: std::collections::HashSet<usize> = pick.iter().copied().collect();
                let m = self.image_map(lot, safe_part(g)?)?;
                let keys: Vec<&String> = m.map.iter().filter(|(_, d)| set.contains(d)).map(|(k, _)| k).collect();
                Ok(Reply::json(&json!({"keys": keys, "detects": pick, "nimg": keys.len(), "totalimg": m.map.len(),
                                       "ndet": pick.len(), "totaldet": det.records.len()})))
            }
            _ => Err(Reply::error(404, "知らない問い合わせです")),
        }
    }

    fn lotres(&self, path: &str) -> Result<Arc<LotRes>, Reply> {
        self.lots.get(path, &self.cfg, self.program.as_ref()).map_err(|e| Reply::error(404, &e))
    }

    /// 問い合わせ 1 つ。知らない道は None（呼ぶ側が静的ファイル・404 にする）。
    pub fn handle(&self, method: &str, path: &str, query: &str, body: &[u8]) -> Option<Reply> {
        let a = Args(parse_query(query));
        let b: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
        let r: R = match (method, path) {
            ("GET", "/api/equipments") => Ok(Reply::json(&Value::Array(
                self.cfg.v["equipments"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|e| json!({"name": e["name"], "path": e["path"]}))
                    .collect(),
            ))),
            ("GET", "/api/children") => self.children(&a),
            ("POST", "/api/lotsum") => Ok(self.lotsum_many(&b)),
            ("GET", "/api/lots") => self.lots_list(&a),
            ("POST", "/api/lotcols") => Ok(Reply::json(&crate::lotlist::columns(self, &strs(&b["paths"])))),
            ("POST", "/api/lotrows") => Ok(self.lot_rows(&b)),
            // LotScope から持ち込んだ部品（shared.js）が画面の設定の控えを送る先。DefectTrace は設定を窓の保存（localStorage）にだけ置くので、受けて返すだけ
            ("POST", "/api/ui-state") => Ok(Reply::json(&json!({"rev": 0}))),
            (m, p) if p == "/api/me" || p == "/api/heartbeat" || p.starts_with("/api/presence") => self.presence_api(m, p, &a, &b),
            ("POST", "/api/open") => self.open(&b),
            ("GET", "/api/status") => self.status(&a),
            ("GET", "/api/info") => a.req("lot").and_then(|l| self.lot_info(l)).map(|v| Reply::json(&v)),
            ("GET", "/api/dat") => self.dat(&a),
            ("GET", "/api/imgmap") => self.api_imgmap(&a),
            ("GET", "/api/imginfo") => self.imginfo(&a),
            ("GET", "/api/map") => self.map(&a),
            (m, p) if p == "/api/filters" || p.starts_with("/api/filters/") => self.filters_api(m, p, &a, &b),
            ("GET", "/api/pairs") => self.pairs(&a),
            ("GET", "/api/pitch") => self.pitch(&a),
            ("GET", "/img") => self.image(&a, false),
            ("GET", "/thumb") => self.image(&a, true),
            ("GET", "/api/pins") => Ok(Reply::json(&json!(self.pins.snapshot()))),
            ("POST", "/api/pins") => {
                let shared = self.shared_dir();
                let initial = crate::pins::Initial { home: &self.cfg.home, shared: shared.as_deref() }.pins();
                self.pins_changed(self.pins.add(&b, images::new_id("p_"), &initial).map_err(|e| (400, e)))
            }
            ("POST", "/api/pins/reset") => {
                let shared = self.shared_dir();
                self.pins_changed(Ok(self.pins.reset(crate::pins::Initial { home: &self.cfg.home, shared: shared.as_deref() }.pins())))
            }
            (m, "/api/pins/default") => self.pins_default(m),
            (m, p) if p.starts_with("/api/pins/") => {
                let pid = unquote(&p["/api/pins/".len()..]);
                match m {
                    "PATCH" => self.pins_changed(self.pins.patch(&pid, &b)),
                    "DELETE" => self.pins_changed(Ok(self.pins.delete(&pid))),
                    _ => return None,
                }
            }
            _ => return None,
        };
        Some(r.unwrap_or_else(|e| e))
    }

    /// だれが・どの PC で・どの版か（GET /api/me）、心拍（POST /api/heartbeat {left}）、使用状況（GET /api/presence）、
    /// 使用の履歴（GET /api/presence/sessions?key&limit）、管理（開発者だけ: POST /api/presence/{forget {key}|retention {days}|prune}）。
    /// 置き場は共有の置き場の presence（program/docs/APP-MANAGEMENT.md）。届かなければ shared: false で答え、何も書かない。
    fn presence_api(&self, method: &str, path: &str, a: &Args, b: &Value) -> R {
        use crate::presence as pr;
        let who = self.cfg.who();
        let version = env!("CARGO_PKG_VERSION");
        let shared = self.shared_dir();
        let dir = shared.as_deref().map(pr::dir_of);
        let me = json!({"login": who.login, "pc": who.pc, "pcSource": who.pc_source, "developer": who.developer, "version": version,
                        "key": pr::key(&who.login, &who.pc), "shared": dir.is_some()});
        let fail = |e: String| Reply::error(400, &e);
        let need_dev =
            || if who.developer { Ok(()) } else { Err(Reply::error(403, "使用状況の記録を消せるのは開発者だけです")) };
        let Some(dir) = dir else {
            return match (method, path) {
                ("GET", "/api/me") | ("POST", "/api/heartbeat") => Ok(Reply::json(&json!({"me": me}))),
                _ => Err(Reply::error(
                    503,
                    "共有の置き場に届きません（使用状況は、配布の置き場の DefectTrace\\shared\\presence に記録します）",
                )),
            };
        };
        let t = pr::now();
        match (method, path) {
            ("GET", "/api/me") => Ok(Reply::json(&json!({"me": me}))),
            ("POST", "/api/heartbeat") => {
                let m = pr::Me { login: &who.login, pc: &who.pc, version, developer: who.developer };
                let k = self.session.beat(&dir, &m, t, b["left"].as_bool().unwrap_or(false)).map_err(fail)?;
                Ok(Reply::json(&json!({"me": me, "nudge": pr::my_nudge(&dir, &k, version)})))
            }
            ("GET", "/api/presence") => {
                let mut v = pr::fleet(&dir, shared.as_deref().and_then(pr::distributed).as_deref(), t);
                v["me"] = me;
                Ok(Reply::json(&v))
            }
            ("GET", "/api/presence/sessions") => {
                let limit = a.get("limit").and_then(|s| s.parse().ok()).unwrap_or(300usize).min(5000);
                Ok(Reply::json(&json!({"sessions": pr::sessions(&dir, a.get("key"), limit), "historyDays": pr::history_days(&dir)})))
            }
            ("POST", "/api/presence/forget") => {
                need_dev()?;
                pr::forget(&dir, b["key"].as_str().unwrap_or(""), t).map(|_| Reply::json(&json!({"ok": true}))).map_err(fail)
            }
            ("POST", "/api/presence/retention") => {
                need_dev()?;
                pr::set_history_days(&dir, b["days"].as_i64().unwrap_or(0), &who.login)
                    .map(|d| Reply::json(&json!({"historyDays": d})))
                    .map_err(fail)
            }
            ("POST", "/api/presence/nudge") => {
                need_dev()?;
                let want =
                    shared.as_deref().and_then(pr::distributed).or_else(|| pr::fleet(&dir, None, t)["latest"].as_str().map(str::to_string));
                pr::nudge(&dir, b["key"].as_str().unwrap_or(""), want.as_deref().unwrap_or(""), &who.login, t)
                    .map(|v| Reply::json(&v))
                    .map_err(fail)
            }
            ("POST", "/api/presence/prune") => {
                need_dev()?;
                Ok(Reply::json(&json!({"removed": pr::prune_all(&dir, t)})))
            }
            _ => Err(Reply::error(404, "not found")),
        }
    }

    /// 表示の初期値: 見る（GET）・いまの表示を開発者の初期値にする（POST）・やめてアプリの物に戻す（DELETE）。
    fn pins_default(&self, method: &str) -> R {
        let who = self.cfg.who();
        let shared = self.shared_dir();
        let ini = crate::pins::Initial { home: &self.cfg.home, shared: shared.as_deref() };
        let r = match method {
            "GET" => Ok(ini.get()),
            "POST" => ini.set(&self.pins.snapshot(), &who.login, who.developer),
            "DELETE" => ini.clear(who.developer),
            _ => return Err(Reply::error(405, "method")),
        };
        r.map(|mut v| {
            v["me"] = json!({"login": who.login, "developer": who.developer});
            Reply::json(&v)
        })
        .map_err(|e| Reply::error(400, &e))
    }

    fn pins_changed(&self, r: Result<Vec<Value>, (u16, String)>) -> R {
        match r {
            Ok(v) => {
                self.lotsum.clear();
                Ok(Reply::json(&json!(v)))
            }
            Err((s, e)) => Err(Reply::error(s, &e)),
        }
    }

    fn children(&self, a: &Args) -> R {
        let p = PathBuf::from(a.req("path")?);
        let rd = std::fs::read_dir(&p).map_err(|e| Reply::error(400, &format!("開けません: {} ({})", p.display(), os_err(&e))))?;
        let mut out: Vec<(String, Value)> = rd
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let kind = if self.lot_re.is_match(&name) { "lot" } else { "dir" };
                (name.clone(), json!({"name": name, "path": e.path().display().to_string(), "kind": kind}))
            })
            .collect();
        out.sort_by(|x, y| natcmp(&y.0, &x.0));
        Ok(Reply::json(&Value::Array(out.into_iter().map(|x| x.1).collect())))
    }

    /// ロット一覧の 1 行（一覧の項目・多量などの印）。
    pub fn lot_summary(&self, path: &str) -> Value {
        if let Some(v) = self.lotsum.get(&path.to_string()) {
            return v;
        }
        let (d, t) = lot::lot_dt(&name_of(Path::new(path)));
        let res = self.lotres(path).ok();
        let pins = self.pins.snapshot();
        let items: Vec<Value> = match &res {
            Some(res) => pins
                .iter()
                .filter(|p| p["place"] == "list")
                .map(|p| json!({"id": p["id"], "label": p["label"], "key": p["key"], "file": p["file"], "value": resolve_lot_pin(res, p)}))
                .collect(),
            None => vec![],
        };
        let flags = match &res {
            Some(res) => lot::lot_flags(res),
            None => json!({"error": "lot not found"}),
        };
        let r = json!({"date": d, "time": t, "items": items, "flags": flags});
        let w = 256 + r.to_string().len();
        self.lotsum.insert(path.to_string(), r, w)
    }

    /// 一覧の行を並べて作る（共有の読みを待つ間に次を進める。8 本まで）。
    fn lotsum_many(&self, b: &Value) -> Reply {
        let paths: Vec<String> =
            b["paths"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
        let next = std::sync::atomic::AtomicUsize::new(0);
        let out: Mutex<Map<String, Value>> = Mutex::default();
        std::thread::scope(|s| {
            for _ in 0..paths.len().min(8) {
                s.spawn(|| loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let Some(p) = paths.get(i) else { break };
                    let v = self.lot_summary(p);
                    out.lock().unwrap().insert(p.clone(), v);
                });
            }
        });
        Reply::json(&Value::Object(out.into_inner().unwrap()))
    }

    /// リスト表示: 木の節の下のロット（新しい順）。
    fn lots_list(&self, a: &Args) -> R {
        let p = PathBuf::from(a.req("path")?);
        if !p.is_dir() {
            return Err(Reply::error(400, &format!("開けません: {}", p.display())));
        }
        let lots: Vec<Value> = crate::lotlist::lots_under(&p, &self.lot_re, 6)
            .iter()
            .map(|l| {
                let n = name_of(l);
                let (d, t) = lot::lot_dt(&n);
                json!({"name": n, "path": l.display().to_string(), "date": d, "time": t})
            })
            .collect();
        Ok(Reply::json(&json!({"lots": lots})))
    }

    /// リスト表示: ロットごとの値（{paths, cols: [{file, key, scale?, fmt?}], refresh?}。scale・fmt は表示項目と同じ。
    /// refresh: 覚えを捨てて読み直す。cached: 読まずに覚えている値だけ〈無い所は null〉）。
    fn lot_rows(&self, b: &Value) -> Reply {
        let cols: Vec<Value> = b["cols"].as_array().cloned().unwrap_or_default();
        let flag = |k: &str| b[k].as_bool().unwrap_or(false);
        Reply::json(&crate::lotlist::values(self, &strs(&b["paths"]), &cols, flag("refresh"), flag("cached")))
    }

    fn open(&self, b: &Value) -> R {
        let lot = b["lot"].as_str().ok_or_else(|| Reply::error(400, "lot がありません"))?;
        self.images.open(Path::new(lot)).map_err(|e| Reply::error(404, &e))?;
        Ok(Reply::json(&json!({"ok": true})))
    }

    fn status(&self, a: &Args) -> R {
        let lot = a.req("lot")?;
        let job = self.images.job(Path::new(lot), false).map_err(|e| Reply::error(404, &e))?;
        Ok(Reply::json(&job.status(a.get("brief") == Some("1"))))
    }

    fn dat(&self, a: &Args) -> R {
        let res = self.lotres(a.req("lot")?)?;
        let d = res.dat(safe_part(a.req("name")?)?);
        let n = a.get("n").and_then(|x| x.trim().parse::<usize>().ok()).unwrap_or(20);
        Ok(Reply::json(&dat_json(&d, n)))
    }

    // -------------------------------------------------------------- ロット情報
    pub fn lot_info(&self, path: &str) -> Result<Value, Reply> {
        let res = self.lotres(path)?;
        let lotname = name_of(&res.lot);
        let (d, t) = lot::lot_dt(&lotname);
        let pinned: Vec<Value> = self
            .pins
            .snapshot()
            .iter()
            .filter(|p| p["scope"] == "lot")
            .map(|p| json!({"id": p["id"], "place": p["place"], "label": p["label"], "value": resolve_lot_pin(&res, p)}))
            .collect();
        let (mut xmls, mut files, mut total) = (vec![], vec![], 0u64);
        for fp in &res.rel {
            let sz = std::fs::metadata(fp).map(|m| m.len()).unwrap_or(0);
            total += sz;
            let rel = fp.strip_prefix(&res.lot).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            files.push((rel.clone(), sz));
            let low = name_of(fp).to_lowercase();
            if low.ends_with(".xml") && sz < 5_000_000 && !low.ends_with("def.xml") && low != "inspectdatainfo.xml" {
                let labels = res.xml_labels_for(&rel);
                let items: Vec<Value> = xml::pairs(fp).iter().map(|(k, v)| json!([k, v, xml::label_for(k, &labels)])).collect();
                xmls.push((rel.clone(), json!({"name": rel, "glob": xml::generalize(&rel), "items": items})));
            }
        }
        files.sort_by(|a, b| natcmp(&a.0, &b.0));
        xmls.sort_by(|a, b| {
            let ka = !a.0.to_lowercase().starts_with("cond/cond");
            let kb = !b.0.to_lowercase().starts_with("cond/cond");
            ka.cmp(&kb).then(natcmp(&a.0, &b.0))
        });
        let mut dats = vec![];
        for (name, _) in &files {
            if name.to_lowercase().ends_with(".dat") && !name.contains('/') {
                let n = &name[..name.len() - 4];
                let r = res.dat(n);
                let cnt = r.records.len();
                let mut item = json!({"name": n, "count": cnt, "error": r.error, "fields": []});
                if (1..=3).contains(&cnt) {
                    let rec = &r.records[0];
                    item["fields"] =
                        json!(r.value_fields().zip(&rec.vals).map(|(f, v)| json!([f.name, fmt_val(v), f.label])).collect::<Vec<_>>());
                }
                dats.push(item);
            }
        }
        let meta: Vec<Value> = lot::LOT_META
            .iter()
            .map(|(k, lab)| json!([k, lot::lot_meta_value(&lotname, k, Some(if *k == "time" { "hhmmss" } else { "yyyymmdd" })), lab]))
            .collect();
        let groups: Map<String, Value> =
            images::image_groups(&res.lot).iter().map(|(g, u)| (g.clone(), json!(images::units_label(u)))).collect();
        Ok(json!({"lot": lotname, "path": res.lot.display().to_string(), "date": d, "time": t, "pinned": pinned,
            "xml": xmls.into_iter().map(|x| x.1).collect::<Vec<_>>(), "dat": dats,
            "meta": meta, "classes": lot::class_summary(&res), "overload": lot::overload_count(&res, true), "timecheck": lot::time_check(&res, false),
            "files": files.iter().map(|(n, s)| json!({"name": n, "size": s})).collect::<Vec<_>>(), "cab_groups": groups, "total_bytes": total,
            "sides": res.sides_json(), "kinds": res.kinds_json(), "work": lot::work_info(&self.cfg, &lotname)}))
    }

    // -------------------------------------------------------------- 画像と欠陥の対応
    /// 画像 N.bmp → IMAGE_LINK（image_fileno=N）→ DETECT_INFO[detect_recno]。名前が数でなければ並びの順。
    pub fn image_map(&self, lot: &str, g: &str) -> Result<Arc<ImgMap>, Reply> {
        let job = self.images.job(Path::new(lot), true).map_err(|e| Reply::error(404, &e))?;
        // 対応付けは全部の名前で作る（名前は開いてすぐ裏で読み終わる。共有が止まっていても 1 分で諦めて、分かった分で作る）
        job.wait_named(Duration::from_secs(60));
        let (units, complete) = job.names(g);
        let nimg: usize = units.iter().map(|(_, n)| n.len()).sum();
        let ck = (lot.to_string(), g.to_string());
        if let Some(m) = self.imgmap.get(&ck) {
            if m.n == nimg && m.fin {
                return Ok(m.clone());
            }
        }
        let res = self.lotres(lot)?;
        let det = res.dat("DETECT_INFO");
        let link = match self.cfg.v["link_map"][g].as_str() {
            Some(name) => res.dat(name),
            None => Arc::new(Dat::default()),
        };
        let mut out = ImgMap { n: nimg, fin: complete, ..Default::default() };
        let size_or_err = |d: &Dat| d.error.clone().map(Value::from).unwrap_or_else(|| json!(d.records.len()));
        if det.records.is_empty() || link.records.is_empty() {
            out.info = json!({"detect": size_or_err(&det), "link": size_or_err(&link)});
            let m = Arc::new(out);
            self.imgmap.put(ck, m.clone(), m.bytes());
            return Ok(m);
        }
        let mut all: Vec<(String, String)> = vec![];
        let (mut seen, mut unique) = (std::collections::HashSet::new(), true);
        for (cab, names) in &units {
            for n in names {
                all.push((cab.clone(), n.clone()));
                let s = Path::new(n).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) || !seen.insert(s) {
                    unique = false;
                }
            }
        }
        if !unique && !complete {
            out.fin = false;
            return Ok(Arc::new(out));
        }
        let fno = |i: usize, n: &str| -> i64 {
            if unique {
                Path::new(n).file_stem().and_then(|s| s.to_string_lossy().parse().ok()).unwrap_or(-1)
            } else {
                i as i64
            }
        };
        let mut by_fno: HashMap<i64, &crate::dat::Rec> = HashMap::new();
        for r in &link.records {
            by_fno.entry(link.get(r, "image_fileno").and_then(V::int).unwrap_or(-1)).or_insert(r);
        }
        let nd = det.records.len() as i64;
        let recno = |r: &crate::dat::Rec| link.get(r, "detect_recno").and_then(V::int).unwrap_or(-1);
        let ok0 = link
            .records
            .iter()
            .take(200)
            .filter(|r| {
                let k = recno(r);
                (0..nd).contains(&k) && det.get(&det.records[k as usize], "image_id") == link.get(r, "image_id")
            })
            .count();
        let id2idx: Option<HashMap<String, usize>> = (ok0 == 0).then(|| {
            det.records.iter().enumerate().map(|(i, d)| (det.get(d, "image_id").map(py_str).unwrap_or_else(|| "None".into()), i)).collect()
        });
        for (i, (cab, n)) in all.iter().enumerate() {
            let Some(r) = by_fno.get(&fno(i, n)) else { continue };
            let di = match &id2idx {
                Some(m) => m.get(&link.get(r, "image_id").map(py_str).unwrap_or_else(|| "None".into())).map(|x| *x as i64),
                None => Some(recno(r)),
            };
            if let Some(di) = di.filter(|d| (0..nd).contains(d)) {
                out.map.insert(format!("{cab}/{n}"), di as usize);
                out.order.push((format!("{cab}/{n}"), di as usize));
            }
        }
        out.info = json!({"links": link.records.len(), "detects": det.records.len(), "matched": out.map.len(), "by": if ok0 > 0 { "recno" } else { "image_id" }});
        let m = Arc::new(out);
        self.imgmap.put(ck, m.clone(), m.bytes());
        Ok(m)
    }

    fn card_of(&self, res: &LotRes, d: &Dat, i: usize, cpins: &[Value]) -> Value {
        let r = &d.records[i];
        let k = res.kind_info(d.get(r, "kindID"));
        let s = side_info(res.sides(), d.get(r, "group").unwrap_or(&V::Null));
        let g = |k: &str| d.get(r, k).map(V::to_json).unwrap_or(Value::Null);
        json!({"no": g("detectNo"), "kind": g("kindID"), "kname": k.name, "kmark": k.mark, "kcolor": k.color, "side": g("group"),
               "sname": s.name, "scolor": s.color,
               "vals": cpins.iter().map(|p| if p["file"] == "dat:DETECT_INFO" { rec_value(p, d, Some(r), res, true) } else { String::new() }).collect::<Vec<_>>()})
    }

    fn api_imgmap(&self, a: &Args) -> R {
        let (lot, g) = (a.req("lot")?, safe_part(a.req("g")?)?);
        let m = self.image_map(lot, g)?;
        let res = self.lotres(lot)?;
        let det = res.dat("DETECT_INFO");
        let cpins: Vec<Value> = self.pins.snapshot().into_iter().filter(|p| p["place"] == "card").collect();
        let map: Map<String, Value> = m
            .map
            .iter()
            .map(|(k, &di)| {
                let mut c = self.card_of(&res, &det, di, &cpins);
                c["d"] = json!(di);
                (k.clone(), c)
            })
            .collect();
        Ok(Reply::json(&json!({"map": map, "final": m.fin, "info": m.info, "sides": res.sides_json(), "kinds": res.kinds_json(),
            "card": cpins.iter().map(|p| json!({"id": p["id"], "label": p["label"]})).collect::<Vec<_>>()})))
    }

    fn imginfo(&self, a: &Args) -> R {
        let (lot, g, stem, name) = (a.req("lot")?, safe_part(a.req("g")?)?, safe_part(a.req("cab")?)?, safe_part(a.req("name")?)?);
        let job = self.images.job(Path::new(lot), true).map_err(|e| Reply::error(404, &e))?;
        let res = self.lotres(lot)?;
        let m = self.image_map(lot, g)?;
        let di = m.map.get(&format!("{stem}/{name}")).copied();
        let det = res.dat("DETECT_INFO");
        let rec = di.map(|i| &det.records[i]);
        let mut fields = vec![];
        if let Some(r) = rec {
            for vk in ["@os_x", "@insp_width"] {
                let v = rec_get(&det, r, vk).unwrap_or(V::Null);
                fields.push(json!([vk, fmt_num(&v, None), lot::virtual_label(vk)]));
            }
            for (f, v) in det.value_fields().zip(&r.vals) {
                let sv = match f.name.as_str() {
                    "group" => format!("{} {}", py_str(v), side_info(res.sides(), v).name),
                    "camera" => format!("{} {}", py_str(v), res.cam_label(v)),
                    k if lot::KIND_KEYS.contains(&k) => format!("{} {}", py_str(v), res.kind_info(Some(v)).name),
                    _ => fmt_val(v),
                };
                fields.push(json!([f.name, sv, f.label]));
            }
        }
        let xmls: Vec<(String, xml::Pairs)> = job.with(&self.images).image_xml(g, stem, name);
        let pairs: Vec<(String, String)> = xmls.iter().flat_map(|(_, p)| p.iter().cloned()).collect();
        let (mut card, mut pinned) = (vec![], vec![]);
        for p in self.pins.snapshot() {
            let place = p["place"].as_str().unwrap_or("");
            if !matches!(place, "card" | "image") || p["scope"] != "image" {
                continue;
            }
            let val = if p["file"] == "dat:DETECT_INFO" {
                rec_value(&p, &det, rec, &res, place == "card")
            } else {
                xml::match_values(&pairs, p["key"].as_str().unwrap_or("")).join(" ")
            };
            let item = json!({"id": p["id"], "label": p["label"], "value": val});
            if place == "card" {
                card.push(item)
            } else {
                pinned.push(item)
            }
        }
        let (w, h, bits) = job.with(&self.images).image_head(g, stem, name);
        let head = di.map(|i| self.card_of(&res, &det, i, &[]));
        Ok(Reply::json(&json!({"width": w, "height": h, "bits": bits, "detect_index": di, "head": head, "detect": fields,
            "xml": xmls.iter().map(|(n, p)| json!({"name": n, "items": p.iter().map(|(k, v)| json!([k, v, ""])).collect::<Vec<_>>()})).collect::<Vec<_>>(),
            "card": card, "pinned": pinned, "map_final": m.fin, "map_info": m.info})))
    }

    fn map(&self, a: &Args) -> R {
        let (lot, g) = (a.req("lot")?, safe_part(a.req("g")?)?);
        let res = self.lotres(lot)?;
        let det = res.dat("DETECT_INFO");
        let pins = self.pins.snapshot();
        let pin = |pl: &str| pins.iter().find(|p| p["place"] == pl).cloned();
        if det.records.is_empty() {
            return Ok(Reply::json(
                &json!({"ok": false, "msg": det.error.clone().unwrap_or_else(|| "DETECT_INFO なし".into()), "points": []}),
            ));
        }
        let (Some(px), Some(py)) = (pin("mapx"), pin("mapy")) else {
            return Ok(Reply::json(&json!({"ok": false, "msg": "MAP X/Y に DETECT_INFO の項目を設定してください", "points": []})));
        };
        if px["file"] != "dat:DETECT_INFO" || py["file"] != "dat:DETECT_INFO" {
            return Ok(Reply::json(&json!({"ok": false, "msg": "MAP X/Y に DETECT_INFO の項目を設定してください", "points": []})));
        }
        let m = self.image_map(lot, g)?;
        let rev = m.rev();
        let (kx, ky) = (px["key"].as_str().unwrap_or(""), py["key"].as_str().unwrap_or(""));
        let (sx, sy) = (px["scale"].as_f64(), py["scale"].as_f64());
        let dflt = |r: &crate::dat::Rec, k: &str| match det.col(k) {
            Some(i) => r.vals[i].to_json(),
            None => json!(0),
        };
        let mut pts = vec![];
        for (i, r) in det.records.iter().enumerate() {
            if det.get(r, "type").map(|t| t.int() != Some(1)).unwrap_or(false) {
                continue;
            }
            let (Some(x), Some(y)) = (lot::to_num(rec_get(&det, r, kx).as_ref(), sx), lot::to_num(rec_get(&det, r, ky).as_ref(), sy))
            else {
                continue;
            };
            pts.push(json!([
                round_to(x, 3),
                round_to(y, 4),
                dflt(r, "group"),
                dflt(r, "kindID"),
                rev.get(&i),
                det.get(r, "detectNo").map(V::to_json),
                i
            ]));
            if pts.len() >= 50000 {
                break;
            }
        }
        let insp = res.dat("INSP_INFO");
        let len_m = insp.first().and_then(|r| lot::to_num(insp.get(r, "insp_end_y"), Some(0.001)));
        let mut bands = vec![];
        if matches!(kx, "@os_x" | "x_mm") && ky == "y_mm" {
            let types = self.cfg.ints("overload_types");
            let kids = self.cfg.ints("overload_kind_ids");
            let (types, kids) = (if types.is_empty() { vec![2] } else { types }, if kids.is_empty() { vec![1100] } else { kids });
            let sc = sy.filter(|s| *s != 0.0).unwrap_or(1.0);
            for r in &det.records {
                if !lot::is_overload(&det, r, &types, &kids, &Default::default()) {
                    continue;
                }
                let Some(xc) = lot::to_num(rec_get(&det, r, kx).as_ref(), None) else { continue };
                let Some(y) = det.get(r, "y_mm").and_then(V::num) else { continue };
                let w = det.get(r, "width_mm").and_then(V::num).unwrap_or(0.0);
                let ln = det.get(r, "length_mm").and_then(V::num).unwrap_or(0.0);
                bands.push(json!([
                    round_to(xc - w / 2.0, 1),
                    round_to(xc + w / 2.0, 1),
                    round_to(y * sc, 4),
                    round_to(ln * sc, 4),
                    dflt(r, "group")
                ]));
                if bands.len() >= 20000 {
                    break;
                }
            }
        }
        Ok(Reply::json(
            &json!({"ok": true, "points": pts, "bands": bands, "sides": res.sides_json(), "kinds": res.kinds_json(), "final": m.fin,
            "labels": {"mapx": px["label"], "mapy": py["label"]}, "len_m": len_m}),
        ))
    }

    fn pairs(&self, a: &Args) -> R {
        let lot = a.req("lot")?;
        let g = safe_part(a.get("g").unwrap_or("img"))?;
        let tol = a.get("tol").map(|t| pyfloat(t).map(|x| x.max(0.0)).unwrap_or(5.0)).unwrap_or(5.0);
        let maxdy = a.get("maxdy").filter(|s| !s.is_empty()).and_then(pyfloat);
        let mirror = a.get("mirror") == Some("1");
        let res = self.lotres(lot)?;
        let det = res.dat("DETECT_INFO");
        if det.records.is_empty() {
            return Ok(Reply::json(
                &json!({"ok": false, "msg": det.error.clone().unwrap_or_else(|| "DETECT_INFO なし".into()), "defects": [], "pairs": []}),
            ));
        }
        let m = self.image_map(lot, g)?;
        let mut v = analysis::pairs(&res, &m.rev(), tol, maxdy, mirror);
        v["final"] = json!(m.fin);
        Ok(Reply::json(&v))
    }

    fn pitch(&self, a: &Args) -> R {
        let lot = a.req("lot")?;
        let g = safe_part(a.get("g").unwrap_or("img"))?;
        let num = |k: &str, d: f64, lo: f64| match a.get(k) {
            None | Some("") => d,
            Some(v) => pyfloat(v).map(|x| x.max(lo)).unwrap_or(d),
        };
        let pmax = match a.get("pmax") {
            None | Some("") => None,
            Some(v) => pyfloat(v).map(|x| x.max(0.0)),
        };
        let c = PitchCond {
            tol: num("tol", 5.0, 0.0),
            ytol: num("ytol", 0.03, 0.0),
            min_n: num("n", 3.0, 1.0) as usize,
            pmin: num("pmin", 0.1, 0.0),
            pmax,
            skip: num("skip", 0.0, 0.0).min(3.0) as usize,
        };
        let res = self.lotres(lot)?;
        let det = res.dat("DETECT_INFO");
        if det.records.is_empty() {
            return Ok(Reply::json(
                &json!({"ok": false, "msg": det.error.clone().unwrap_or_else(|| "DETECT_INFO なし".into()), "chains": []}),
            ));
        }
        let m = self.image_map(lot, g)?;
        let mut v = analysis::pitch(&res, &m.rev(), c);
        v["final"] = json!(m.fin);
        Ok(Reply::json(&v))
    }

    fn image(&self, a: &Args, thumb: bool) -> R {
        let (lot, g, stem, name) = (a.req("lot")?, safe_part(a.req("g")?)?, safe_part(a.req("cab")?)?, safe_part(a.req("name")?)?);
        let job = self.images.job(Path::new(lot), true).map_err(|e| Reply::error(404, &e))?;
        let jr = job.with(&self.images);
        let r = if thumb { jr.thumb(g, stem, name) } else { jr.original(g, stem, name) };
        match r {
            Ok((ctype, body)) => Ok(Reply::bytes(&ctype, body, "max-age=3600")),
            Err(e) => Err(Reply::error(404, &e)),
        }
    }

    /// 画面の問い合わせ（API → 画面の HTML → /static/ の部品）。無ければ 404。
    pub fn handle_all(&self, method: &str, path: &str, query: &str, body: &[u8], static_dir: &Path, version: &str) -> Reply {
        self.handle(method, path, query, body)
            .or_else(|| match (method, path) {
                ("GET", "/") | ("GET", "/index.html") => self.index_html(static_dir, version),
                ("GET" | "HEAD", p) => p.strip_prefix("/static/").map(|rest| static_file(static_dir, rest, query)),
                _ => None,
            })
            .unwrap_or_else(|| Reply::error(404, "ありません。"))
    }

    /// 画面の HTML（JS・CSS の URL に版を付ける。版が変われば読み直す）。
    pub fn index_html(&self, static_dir: &Path, version: &str) -> Option<Reply> {
        let html = std::fs::read_to_string(static_dir.join("index.html")).ok()?;
        Some(Reply::bytes("text/html; charset=utf-8", html.replace("{{v}}", version).into_bytes(), "no-cache"))
    }

    /// 縮小画像・展開した画像の置き場の片付け（古いロットから）。
    pub fn prune(&self) {
        self.images.prune();
    }

    pub fn glob(&self, lot: &Path, pat: &str) -> Vec<PathBuf> {
        glob(lot, pat)
    }
}

/// /static/ の下のファイル。static フォルダの外へは出ない（.. や絶対パスは断る）。
pub fn static_file(root: &Path, rest: &str, query: &str) -> Reply {
    let decoded = unquote(rest);
    let rel = Path::new(&decoded);
    if decoded.contains('\\') || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Reply::error(404, "ありません。");
    }
    match std::fs::read(root.join(rel)) {
        Ok(body) => {
            // 版の付いた URL（?v=版）は、版が変われば URL も変わるので長く使い回す
            let cache = if query.split('&').any(|kv| kv.starts_with("v=")) { "public, max-age=31536000, immutable" } else { "no-cache" };
            Reply::bytes(mime(&decoded), body, cache)
        }
        Err(_) => Reply::error(404, "ありません。"),
    }
}

pub fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// .dat の答え（先頭 n 件）。
pub fn dat_json(d: &Dat, n: usize) -> Value {
    json!({"name": d.name, "version": d.version, "error": d.error, "layout": d.layout, "dt_mode": d.dt_mode,
           "fields": d.fields.iter().map(|f| json!({"name": f.name, "label": f.label, "type": f.typ})).collect::<Vec<_>>(),
           "records": d.records.iter().take(n).map(|r| d.rec_json(r)).collect::<Vec<_>>(), "count": d.records.len()})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_is_decoded() {
        assert_eq!(
            parse_query("a=1&path=%2Ftmp%2F%E3%81%82+b&e="),
            [("a", "1"), ("path", "/tmp/あ b"), ("e", "")].map(|(a, b)| (a.to_string(), b.to_string()))
        );
        assert_eq!(unquote("100%"), "100%");
        assert_eq!(unquote("%zz"), "%zz");
        assert_eq!(pyfloat(" 5 "), Some(5.0));
        assert!(pyfloat("x").is_none());
    }

    #[test]
    fn static_files_stay_inside() {
        let dir = std::env::temp_dir().join(format!("dt-static-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("app.js"), "x=1").unwrap();
        let r = static_file(&dir, "app.js", "v=4.0.0");
        assert_eq!((r.status, r.body.as_slice()), (200, b"x=1".as_slice()));
        assert!(r.headers.iter().any(|(k, v)| k == "Cache-Control" && v.contains("immutable")), "版付きは使い回す");
        for bad in ["../secret", "%2e%2e/x", "/etc/passwd", "a\\..\\b", "none.js"] {
            assert_eq!(static_file(&dir, bad, "").status, 404, "{bad}");
        }
        std::fs::remove_dir_all(&dir).ok();
    }
}
