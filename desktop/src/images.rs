//! ロットの画像: 画像フォルダの見分け・名前の一覧・縮小画像づくり（裏・並べて）・原寸の取り出し。
//!
//! 決め方: 7 案を同じロットで測って、別のエージェントが採点した（program/tools/proposals/2026-10-26-image-loading.*。v7 に決めた）。
//! - 名前は CAB の頭だけを読んで先に出す（開いた瞬間に、カードの枠と数を全部並べられる）
//! - 作業場所には縮小画像だけを書く（原寸を展開してディスクへ書かない。書く量は版 3.8 の約 1/20）
//! - 裏の仕事は画面の並びの順（前ほど先）。いま開いたロットを先にし、画面が欲しがった縮小画像はその CAB を最優先へ割り込ませる
//! - 縮小は 1 枚ずつ PC の芯へ配る。CAB は 1 回で読み、伸ばしながら縮める（読み直さない）
//! - 原寸は開いたときに CAB をメモリで伸ばし、最近の CAB は覚えておく（同じ CAB の続きはすぐ出る）
//!
//! 画像の置き方（設備ごと）: CAB（img/0000.cab …）・フォルダ（img/0000/*.bmp）・直下（img/*.bmp）。後の 2 つは共有から直に読む。

use crate::cab::Cab;
use crate::config::Config;
use crate::lot::{is_image, name_of};
use crate::pool::Pool;
use crate::pyfmt::natcmp;
use crate::thumb;
use crate::xml;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// 画像フォルダの中の 1 つの塊。
#[derive(Debug, Clone, PartialEq)]
pub struct Unit {
    pub stem: String,
    /// cab・dir・loose
    pub kind: &'static str,
    pub path: PathBuf,
}

const SKIP_DIRS: [&str; 3] = ["cond", "option", "wavedata"];

fn has_images(p: &Path) -> bool {
    std::fs::read_dir(p).map(|rd| rd.flatten().any(|e| e.path().is_file() && is_image(&e.file_name().to_string_lossy()))).unwrap_or(false)
}

/// {画像フォルダの名前: [塊]}（img が先、ほかは名前の順）。画像の無いフォルダは入れない。
pub fn image_groups(lot: &Path) -> Vec<(String, Vec<Unit>)> {
    let mut groups = vec![];
    let Ok(rd) = std::fs::read_dir(lot) else { return groups };
    for c in rd.flatten() {
        let name = c.file_name().to_string_lossy().into_owned();
        if !c.path().is_dir() || SKIP_DIRS.contains(&name.to_lowercase().as_str()) {
            continue;
        }
        let Ok(ents) = std::fs::read_dir(c.path()) else { continue };
        let ents: Vec<std::fs::DirEntry> = ents.flatten().collect();
        let sorted = |mut v: Vec<PathBuf>| {
            v.sort_by(|a, b| natcmp(&name_of(a), &name_of(b)));
            v
        };
        let cabs = sorted(ents.iter().map(|e| e.path()).filter(|p| p.is_file() && name_of(p).to_lowercase().ends_with(".cab")).collect());
        let subs = sorted(ents.iter().map(|e| e.path()).filter(|p| p.is_dir() && has_images(p)).collect());
        let mut units: Vec<Unit> = cabs
            .into_iter()
            .map(|p| Unit { stem: p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), kind: "cab", path: p })
            .collect();
        units.extend(subs.into_iter().map(|p| Unit { stem: name_of(&p), kind: "dir", path: p }));
        if ents.iter().any(|e| e.path().is_file() && is_image(&e.file_name().to_string_lossy())) {
            units.push(Unit { stem: "_".into(), kind: "loose", path: c.path() });
        }
        if !units.is_empty() {
            groups.push((name, units));
        }
    }
    groups.sort_by_key(|(n, _)| (n.to_lowercase() != "img", n.to_lowercase()));
    groups
}

/// ロット情報の「画像フォルダ」の書き方（CAB3・フォルダ1・直下）。
pub fn units_label(units: &[Unit]) -> String {
    let mut order: Vec<(&str, usize)> = vec![];
    for u in units {
        match order.iter_mut().find(|(k, _)| *k == u.kind) {
            Some(x) => x.1 += 1,
            None => order.push((u.kind, 1)),
        }
    }
    order
        .iter()
        .map(|(k, n)| match *k {
            "cab" => format!("CAB{n}"),
            "dir" => format!("フォルダ{n}"),
            _ => "直下".to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// 重ならない短い名前（表示項目の id など）。
pub fn new_id(prefix: &str) -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0) as u64;
    let x = t ^ (std::process::id() as u64).rotate_left(32) ^ N.fetch_add(1, Ordering::SeqCst).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    format!("{prefix}{:08x}", (x ^ (x >> 29)) as u32)
}

fn list_images(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| is_image(n))
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| natcmp(a, b));
    v
}

// ------------------------------------------------------------------ 最近伸ばした CAB（原寸を出すため）
/// 伸ばした CAB の中身（名前 → バイト列）。
type Unpacked = Arc<HashMap<String, Arc<Vec<u8>>>>;

/// 最近伸ばした CAB を覚える（合わせて budget バイトまで。古い物から捨てる）。
struct Recent {
    items: VecDeque<(String, Unpacked, usize)>,
    budget: usize,
}

impl Recent {
    fn get(&mut self, key: &str) -> Option<Unpacked> {
        let i = self.items.iter().position(|x| x.0 == key)?;
        let it = self.items.remove(i)?;
        let v = it.1.clone();
        self.items.push_front(it);
        Some(v)
    }
    fn put(&mut self, key: String, v: Unpacked) {
        let size: usize = v.values().map(|b| b.len()).sum();
        self.items.retain(|x| x.0 != key);
        self.items.push_front((key, v, size));
        let mut total: usize = self.items.iter().map(|x| x.2).sum();
        while total > self.budget && self.items.len() > 1 {
            total -= self.items.pop_back().map(|x| x.2).unwrap_or(0);
        }
    }
}

// ------------------------------------------------------------------ ロットの仕事
#[derive(Debug, Clone, Copy, PartialEq)]
enum State {
    Pending,
    Running,
    Done,
    Error,
}

#[derive(Debug)]
struct UnitState {
    unit: Unit,
    group: String,
    /// 画像の名前（名前の数の順）。CAB は頭から、フォルダは一覧から
    images: Vec<String>,
    /// 名前を読めたか（読めなければ error）
    named: State,
    /// 縮小画像づくり（裏の仕事）
    work: State,
    error: Option<String>,
}

#[derive(Default)]
struct Thumbs {
    /// "g/stem/name" → 済んだ（Ok）・作れなかった（Err）
    done: HashMap<String, Result<(), String>>,
    /// 原寸の頭（幅・高さ・ビット数）
    heads: HashMap<String, (i64, i64, i64)>,
}

pub struct Job {
    pub lot: PathBuf,
    cache: PathBuf,
    units: Mutex<Vec<UnitState>>,
    thumbs: Mutex<Thumbs>,
    cv: Condvar,
    started: Instant,
    total_images: usize,
    /// 開いた順の番号（新しく開いたロットほど大きい。裏の仕事の優先度に使う）
    pub generation: AtomicU64,
}

/// 優先度: いま開いたロット（世代）を先に、その中は画面の並びの順。画面が欲しがった CAB は最優先へ。
fn priority(generation: u64, order: usize) -> i64 {
    (generation as i64) * 10_000_000 - order as i64
}
const URGENT: i64 = i64::MAX / 2;

fn key(g: &str, stem: &str, name: &str) -> String {
    format!("{g}/{stem}/{name}")
}

impl Job {
    fn new(lot: &Path, cache: PathBuf) -> Job {
        let groups = image_groups(lot);
        // 名前を先に（CAB は頭だけ・フォルダは一覧）。共有の遅れを重ねないよう、塊ごとに並べて読む
        let flat: Vec<(String, Unit)> = groups.into_iter().flat_map(|(g, us)| us.into_iter().map(move |u| (g.clone(), u))).collect();
        let named: Vec<UnitState> = std::thread::scope(|s| {
            let hs: Vec<_> = flat
                .chunks(flat.len().div_ceil(8).max(1))
                .map(|chunk| {
                    s.spawn(move || {
                        chunk
                            .iter()
                            .map(|(g, u)| {
                                let r: Result<Vec<String>, String> = match u.kind {
                                    "cab" => Cab::list(&u.path).map_err(|e| e.to_string()).map(|c| {
                                        let mut n: Vec<String> = c.names().into_iter().filter(|n| is_image(n)).collect();
                                        n.sort_by(|a, b| natcmp(a, b));
                                        n
                                    }),
                                    _ => Ok(list_images(&u.path)),
                                };
                                let (images, named, error) = match r {
                                    Ok(v) => (v, State::Done, None),
                                    Err(e) => (vec![], State::Error, Some(e)),
                                };
                                UnitState { unit: u.clone(), group: g.clone(), images, named, work: State::Pending, error }
                            })
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            hs.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
        });
        let total_images = named.iter().map(|u| u.images.len()).sum();
        // 前に作った縮小画像（作業場所に残っている物）は済んだことにする
        let mut th = Thumbs::default();
        for u in &named {
            for n in &u.images {
                let p = cache.join(&u.group).join(&u.unit.stem).join(format!("{n}.jpg"));
                if p.is_file() {
                    th.done.insert(key(&u.group, &u.unit.stem, n), Ok(()));
                }
            }
        }
        let mut units = named;
        for u in units.iter_mut() {
            if u.named == State::Done && u.images.iter().all(|n| th.done.contains_key(&key(&u.group, &u.unit.stem, n))) {
                u.work = State::Done;
            }
        }
        Job {
            lot: lot.to_path_buf(),
            cache,
            units: Mutex::new(units),
            thumbs: Mutex::new(th),
            cv: Condvar::new(),
            started: Instant::now(),
            total_images,
            generation: AtomicU64::new(0),
        }
    }

    fn thumb_path(&self, g: &str, stem: &str, name: &str) -> PathBuf {
        self.cache.join(g).join(stem).join(format!("{name}.jpg"))
    }

    fn unit(&self, g: &str, stem: &str) -> Option<Unit> {
        self.units.lock().unwrap().iter().find(|u| u.group == g && u.unit.stem == stem).map(|u| u.unit.clone())
    }

    /// 画像フォルダ g の [(塊, 名前)] と、全部の名前が分かったか。
    pub fn names(&self, g: &str) -> (Vec<(String, Vec<String>)>, bool) {
        let us = self.units.lock().unwrap();
        let v = us.iter().filter(|u| u.group == g).map(|u| (u.unit.stem.clone(), u.images.clone())).collect();
        (v, us.iter().filter(|u| u.group == g).all(|u| u.named != State::Pending))
    }

    /// 画面へ（GET /api/status）。版 3.8 と同じ形に、縮小画像の進み（thumbs・thumbs_total）と名前が分かったか（named）を足した。
    pub fn status(&self) -> Value {
        let us = self.units.lock().unwrap();
        let th = self.thumbs.lock().unwrap();
        let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
        let mut cabs = vec![];
        let mut thumbs_ready = 0;
        for u in us.iter() {
            *kinds.entry(u.unit.kind).or_default() += 1;
            let ready = u.images.iter().filter(|n| th.done.contains_key(&key(&u.group, &u.unit.stem, n))).count();
            thumbs_ready += ready;
            let state = match u.named {
                State::Error => "error",
                State::Done => "done",
                _ => "pending",
            };
            cabs.push(
                json!({"group": u.group, "cab": u.unit.stem, "kind": u.unit.kind, "state": state, "images": u.images, "error": u.error,
                             "thumbs": ready, "working": u.work == State::Running}),
            );
        }
        let total = us.len();
        let named = us.iter().all(|u| u.named != State::Pending);
        let done = us.iter().filter(|u| u.named != State::Pending).count();
        let finished = named && us.iter().all(|u| matches!(u.work, State::Done | State::Error) || u.named == State::Error);
        json!({"cabs": cabs, "total": total, "done": done, "named": named, "finished": finished, "kinds": kinds,
               "thumbs": thumbs_ready, "thumbs_total": self.total_images, "elapsed": (self.started.elapsed().as_secs_f64() * 10.0).round() / 10.0})
    }

    /// 縮小画像を 1 枚作って書き、済んだことを知らせる。
    fn store_thumb(&self, g: &str, stem: &str, name: &str, src: &[u8], size: usize) {
        let r =
            thumb::thumb_bytes(src, size).and_then(|j| thumb::write_atomic(&self.thumb_path(g, stem, name), &j).map_err(|e| e.to_string()));
        let mut th = self.thumbs.lock().unwrap();
        th.heads.insert(key(g, stem, name), thumb::bmp_size(src));
        th.done.insert(key(g, stem, name), r);
        drop(th);
        self.cv.notify_all();
    }

    fn set_work(&self, g: &str, stem: &str, s: State, err: Option<String>) {
        let mut us = self.units.lock().unwrap();
        if let Some(u) = us.iter_mut().find(|u| u.group == g && u.unit.stem == stem) {
            u.work = s;
            if err.is_some() {
                u.error = err;
            }
        }
    }

    /// まだの塊を「走っている」にする（できたら true）。
    fn claim(&self, g: &str, stem: &str) -> bool {
        let mut us = self.units.lock().unwrap();
        match us.iter_mut().find(|u| u.group == g && u.unit.stem == stem) {
            Some(u) if u.work == State::Pending => {
                u.work = State::Running;
                true
            }
            _ => false,
        }
    }

    /// 縮小画像が済むまで待つ（limit まで）。
    fn wait_thumb(&self, k: &str, limit: Duration) -> Option<Result<(), String>> {
        let end = Instant::now() + limit;
        let mut th = self.thumbs.lock().unwrap();
        loop {
            if let Some(r) = th.done.get(k) {
                return Some(r.clone());
            }
            let now = Instant::now();
            if now >= end {
                return None;
            }
            th = self.cv.wait_timeout(th, end - now).unwrap().0;
        }
    }
}

/// CAB を伸ばす。exe の中で読めない形（Quantum など）は、Windows の expand（ほかは cabextract）で展開して読む。
pub fn unpack_cab(data: &[u8], path: &Path, each: &mut dyn FnMut(&str, &[u8])) -> Result<(), String> {
    let inner = Cab::parse(data).and_then(|c| {
        c.extract(data, &mut |e, b| {
            each(&e.name, b);
            Ok(())
        })
    });
    let Err(e) = inner else { return Ok(()) };
    let tmp = std::env::temp_dir().join(format!("dt-cab-{}", new_id("")));
    std::fs::create_dir_all(&tmp).map_err(|x| x.to_string())?;
    let out = if cfg!(windows) {
        let mut c = std::process::Command::new("expand");
        c.arg(path).arg("-F:*").arg(&tmp);
        #[cfg(windows)]
        std::os::windows::process::CommandExt::creation_flags(&mut c, 0x0800_0000);
        c.output()
    } else {
        std::process::Command::new("cabextract").arg("-q").arg("-d").arg(&tmp).arg(path).output()
    };
    let r = match out {
        Ok(o) if o.status.success() => {
            for f in std::fs::read_dir(&tmp).into_iter().flatten().flatten() {
                if let Ok(b) = std::fs::read(f.path()) {
                    each(&f.file_name().to_string_lossy(), &b);
                }
            }
            Ok(())
        }
        _ => Err(format!("CAB を展開できません: {e}")),
    };
    let _ = std::fs::remove_dir_all(&tmp);
    r
}

/// 全部のロットの画像の仕事。
pub struct Images {
    cfg: Arc<Config>,
    pool: Arc<Pool>,
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    generation: AtomicU64,
    recent: Mutex<Recent>,
    /// 同じ CAB を 2 か所で同時に伸ばさない
    unpacking: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Images {
    pub fn new(cfg: Arc<Config>) -> Arc<Images> {
        let pool = Arc::new(Pool::new(cfg.workers(), "images"));
        // 覚えておく伸ばした CAB の量（既定 160MB ≒ 100 枚の CAB 12 個）。裏の縮小で伸ばした CAB も入れ、古い物から捨てる
        let budget = (cfg.v["memory_mb"].as_u64().unwrap_or(160) as usize) << 20;
        Arc::new(Images {
            cfg,
            pool,
            jobs: Mutex::default(),
            generation: AtomicU64::new(0),
            recent: Mutex::new(Recent { items: VecDeque::new(), budget }),
            unpacking: Mutex::default(),
        })
    }

    pub fn pool(&self) -> &Pool {
        &self.pool
    }

    fn cache_of(&self, lot: &Path) -> PathBuf {
        let parts: Vec<String> = lot.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        let eq = if parts.len() >= 5 { parts[parts.len() - 5].clone() } else { "x".into() };
        let eq: String = eq.chars().map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' }).collect();
        self.cfg.cache_dir().join(format!("{eq}_{}", name_of(lot)))
    }

    /// ロットの仕事（無ければ作る。start なら裏の仕事を並べる）。
    pub fn job(self: &Arc<Self>, lot: &Path, start: bool) -> Result<Arc<Job>, String> {
        let k = lot.display().to_string();
        if let Some(j) = self.jobs.lock().unwrap().get(&k) {
            if start && j.generation.load(Ordering::SeqCst) == 0 {
                self.start(j);
            }
            return Ok(j.clone());
        }
        if !lot.is_dir() {
            return Err("lot not found".into());
        }
        let j = Arc::new(Job::new(lot, self.cache_of(lot)));
        let j = self.jobs.lock().unwrap().entry(k).or_insert(j).clone();
        if start {
            self.start(&j);
        }
        Ok(j)
    }

    /// 開く（POST /api/open）: いちばん新しい世代として、裏の仕事を並べ直す。
    pub fn open(self: &Arc<Self>, lot: &Path) -> Result<(), String> {
        let j = self.job(lot, false)?;
        self.start(&j);
        let me = self.clone();
        std::thread::spawn(move || me.prune());
        Ok(())
    }

    fn start(self: &Arc<Self>, j: &Arc<Job>) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        j.generation.store(generation, Ordering::SeqCst);
        let todo: Vec<(usize, String, Unit)> = j
            .units
            .lock()
            .unwrap()
            .iter()
            .enumerate()
            .filter(|(_, u)| u.named == State::Done && u.work == State::Pending)
            .map(|(i, u)| (i, u.group.clone(), u.unit.clone()))
            .collect();
        let mut order = 0;
        for (_, g, u) in todo {
            self.submit_unit(j, &g, &u, priority(generation, order));
            order += 1000;
        }
    }

    /// 1 つの塊の縮小画像を作る仕事を並べる（もう走っている・済んだ塊は何もしない）。
    fn submit_unit(self: &Arc<Self>, j: &Arc<Job>, g: &str, u: &Unit, pri: i64) {
        let (me, j, g, u) = (self.clone(), j.clone(), g.to_string(), u.clone());
        self.pool.submit(pri, move || {
            // 先に済んだ・走っている（割り込みの写し）なら何もしない
            if !j.claim(&g, &u.stem) {
                return;
            }
            // 古いロット（2 つ以上前に開いた）の残りはしない（もう一度開いたら並べ直す）
            if me.generation.load(Ordering::SeqCst).saturating_sub(j.generation.load(Ordering::SeqCst)) >= 2 && pri != URGENT {
                j.set_work(&g, &u.stem, State::Pending, None);
                return;
            }
            me.run_unit(&j, &g, &u, pri);
        });
    }

    fn run_unit(self: &Arc<Self>, j: &Arc<Job>, g: &str, u: &Unit, pri: i64) {
        let size = self.cfg.v["thumb_size"].as_u64().unwrap_or(256) as usize;
        let names: Vec<String> =
            j.units.lock().unwrap().iter().find(|x| x.group == g && x.unit.stem == u.stem).map(|x| x.images.clone()).unwrap_or_default();
        let order: HashMap<String, usize> = names.iter().enumerate().map(|(i, n)| (n.clone(), i)).collect();
        let pending = |n: &str| !j.thumbs.lock().unwrap().done.contains_key(&key(g, &u.stem, n));
        // 配った縮小の数＋1（伸ばしている間の分）。伸ばし終える前に配った分が全部済んでも、塊を「済んだ」にしない
        let left = Arc::new(AtomicU64::new(1));
        let finish = {
            let (j, g, stem) = (j.clone(), g.to_string(), u.stem.clone());
            move || {
                j.set_work(&g, &stem, State::Done, None);
                j.cv.notify_all();
            }
        };
        let finish = Arc::new(finish);
        let spawn_thumb = |name: String, bytes: Arc<Vec<u8>>| {
            left.fetch_add(1, Ordering::SeqCst);
            let (j2, g2, stem, left2, fin) = (j.clone(), g.to_string(), u.stem.clone(), left.clone(), finish.clone());
            let p = if pri == URGENT {
                URGENT - 1 - *order.get(&name).unwrap_or(&0) as i64
            } else {
                pri - 1 - *order.get(&name).unwrap_or(&0) as i64
            };
            self.pool.submit(p, move || {
                j2.store_thumb(&g2, &stem, &name, &bytes, size);
                if left2.fetch_sub(1, Ordering::SeqCst) == 1 {
                    fin();
                }
            });
        };
        match u.kind {
            "cab" => {
                // 伸ばすのは 1 か所（原寸を開いたときと同じ道。覚えた CAB があれば共有から読み直さない）
                let have = match self.unpacked(j, g, u) {
                    Ok(v) => v,
                    Err(e) => {
                        j.set_work(g, &u.stem, State::Error, Some(e.clone()));
                        return self.fail_unit(j, g, &u.stem, &names, &e);
                    }
                };
                for n in names.iter().filter(|n| pending(n)) {
                    if let Some(b) = have.get(n) {
                        spawn_thumb(n.clone(), b.clone());
                    }
                }
            }
            _ => {
                for n in names.iter().filter(|n| pending(n)) {
                    match std::fs::read(u.path.join(n)) {
                        Ok(b) => spawn_thumb(n.clone(), Arc::new(b)),
                        Err(e) => {
                            j.thumbs.lock().unwrap().done.insert(key(g, &u.stem, n), Err(format!("画像を読めません: {e}")));
                        }
                    }
                }
            }
        }
        if left.fetch_sub(1, Ordering::SeqCst) == 1 {
            finish();
        }
    }

    fn fail_unit(&self, j: &Job, g: &str, stem: &str, names: &[String], why: &str) {
        let mut th = j.thumbs.lock().unwrap();
        for n in names {
            th.done.entry(key(g, stem, n)).or_insert_with(|| Err(why.to_string()));
        }
        drop(th);
        j.cv.notify_all();
    }

    /// CAB を伸ばして画像を返す（最近伸ばした CAB はそのまま）。画像ごとの XML（画像情報に出す・小さい）は作業場所に書く。
    fn unpacked(&self, j: &Job, g: &str, u: &Unit) -> Result<Unpacked, String> {
        let k = format!("{}|{g}|{}", j.lot.display(), u.stem);
        if let Some(v) = self.recent.lock().unwrap().get(&k) {
            return Ok(v);
        }
        let lock = self.unpacking.lock().unwrap().entry(k.clone()).or_default().clone();
        let _g = lock.lock().unwrap();
        if let Some(v) = self.recent.lock().unwrap().get(&k) {
            return Ok(v);
        }
        let data = std::fs::read(&u.path).map_err(|e| format!("CAB を読めません: {e}"))?;
        let mut m = HashMap::new();
        let dir = j.cache.join(g).join(&u.stem);
        unpack_cab(&data, &u.path, &mut |n, b| {
            if is_image(n) {
                m.insert(n.to_string(), Arc::new(b.to_vec()));
            } else if n.to_lowercase().ends_with(".xml") {
                let _ = std::fs::create_dir_all(&dir);
                let _ = std::fs::write(dir.join(n), b);
            }
        })?;
        let v: Unpacked = Arc::new(m);
        self.recent.lock().unwrap().put(k, v.clone());
        Ok(v)
    }

    /// 原寸のバイト列（GET /img）。
    pub fn original(&self, j: &Job, g: &str, stem: &str, name: &str) -> Result<(String, Vec<u8>), String> {
        let u = j.unit(g, stem).ok_or("ありません")?;
        let bytes = match u.kind {
            "cab" => self.unpacked(j, g, &u)?.get(name).map(|b| b.to_vec()).ok_or("ありません")?,
            _ => std::fs::read(u.path.join(name)).map_err(|_| "ありません".to_string())?,
        };
        Ok((image_mime(name).into(), bytes))
    }

    /// 縮小画像（GET /thumb）。まだなら、その塊を最優先にして待つ。
    pub fn thumb(self: &Arc<Self>, j: &Arc<Job>, g: &str, stem: &str, name: &str) -> Result<(String, Vec<u8>), String> {
        let p = j.thumb_path(g, stem, name);
        if let Ok(b) = std::fs::read(&p) {
            return Ok(("image/jpeg".into(), b));
        }
        let u = j.unit(g, stem).ok_or("ありません")?;
        let k = key(g, stem, name);
        if j.wait_thumb(&k, Duration::ZERO).is_none() {
            match u.kind {
                // フォルダ・直下はその 1 枚をすぐ作る
                "dir" | "loose" => {
                    let b = std::fs::read(u.path.join(name)).map_err(|_| "ありません".to_string())?;
                    let size = self.cfg.v["thumb_size"].as_u64().unwrap_or(256) as usize;
                    j.store_thumb(g, stem, name, &b, size);
                }
                _ => self.submit_unit(j, g, &u, URGENT),
            }
        }
        match j.wait_thumb(&k, Duration::from_secs(120)) {
            Some(Ok(())) => std::fs::read(&p).map(|b| ("image/jpeg".to_string(), b)).map_err(|e| e.to_string()),
            Some(Err(e)) => Err(e),
            None => Err("縮小画像が間に合いません".into()),
        }
    }

    /// 原寸の幅・高さ・ビット数（画像情報）。縮小画像を作ったときに控えた物、無ければ原寸の頭を読む。
    pub fn image_head(&self, j: &Job, g: &str, stem: &str, name: &str) -> (i64, i64, i64) {
        if let Some(h) = j.thumbs.lock().unwrap().heads.get(&key(g, stem, name)) {
            return *h;
        }
        self.original(j, g, stem, name).map(|(_, b)| thumb::bmp_size(&b)).unwrap_or((0, 0, 0))
    }

    /// 画像ごとの XML（CAB の中の物は書いておいた物・フォルダは隣の物・設定の image_xml_patterns）。
    pub fn image_xml(&self, j: &Job, g: &str, stem: &str, name: &str) -> Vec<(String, xml::Pairs)> {
        let istem = Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let mut out = vec![];
        let Some(u) = j.unit(g, stem) else { return out };
        let (dir, label) = match u.kind {
            "cab" => (j.cache.join(g).join(stem), format!("{stem}.cab")),
            _ => (u.path.clone(), stem.to_string()),
        };
        let mut found: Vec<PathBuf> = std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                let n = name_of(p);
                let st = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                n.to_lowercase().ends_with(".xml") && (st == istem || st.starts_with(&format!("{istem}_")))
            })
            .collect();
        found.sort();
        out.extend(found.into_iter().map(|p| (format!("{label}/{}", name_of(&p)), xml::pairs(&p))));
        for pat in self.cfg.strs("image_xml_patterns") {
            let rel = pat.replace("{group}", g).replace("{cab}", stem).replace("{idx}", &istem).replace("{name}", name);
            let p = j.lot.join(rel);
            if p.exists() {
                out.push((pat.clone(), xml::pairs(&p)));
            }
        }
        out
    }

    /// 作業場所の縮小画像を、新しいロットから cache_keep_lots 個だけ残す（開いている仕事のロットは消さない）。
    pub fn prune(&self) {
        let keep = self.cfg.v["cache_keep_lots"].as_u64().unwrap_or(30) as usize;
        let Ok(rd) = std::fs::read_dir(self.cfg.cache_dir()) else { return };
        let mut dirs: Vec<(std::time::SystemTime, PathBuf)> = rd
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), e.path()))
            .collect();
        dirs.sort_by_key(|d| std::cmp::Reverse(d.0));
        let active: Vec<PathBuf> = self.jobs.lock().unwrap().values().map(|j| j.cache.clone()).collect();
        for (_, d) in dirs.into_iter().skip(keep) {
            if !active.contains(&d) {
                let _ = std::fs::remove_dir_all(d);
            }
        }
    }
}

impl Job {
    /// 画面の問い合わせのための入口（Images と組で使う）。
    pub fn with<'a>(self: &'a Arc<Self>, images: &'a Arc<Images>) -> JobRef<'a> {
        JobRef { job: self, images }
    }
}

/// 仕事と画像の係の組（app.rs が使う）。
pub struct JobRef<'a> {
    job: &'a Arc<Job>,
    images: &'a Arc<Images>,
}

impl JobRef<'_> {
    pub fn thumb(&self, g: &str, stem: &str, name: &str) -> Result<(String, Vec<u8>), String> {
        self.images.thumb(self.job, g, stem, name)
    }
    pub fn original(&self, g: &str, stem: &str, name: &str) -> Result<(String, Vec<u8>), String> {
        self.images.original(self.job, g, stem, name)
    }
    pub fn image_head(&self, g: &str, stem: &str, name: &str) -> (i64, i64, i64) {
        self.images.image_head(self.job, g, stem, name)
    }
    pub fn image_xml(&self, g: &str, stem: &str, name: &str) -> Vec<(String, xml::Pairs)> {
        self.images.image_xml(self.job, g, stem, name)
    }
}

pub fn image_mime(name: &str) -> &'static str {
    match Path::new(name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).as_deref() {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("tif" | "tiff") => "image/tiff",
        _ => "image/bmp",
    }
}
