//! 画像の読み込み方の案を、同じロットで測り比べる（評価関数）。
//!
//!     cargo run --release --example imgbench -- <ロット> <2 つめのロット> [--latency-ms 3] [--mbps 110] [--variant all|v1,v2,…]
//!
//! 共有フォルダ（SMB）を真似る: ロットから読むときは、開くたびに latency-ms 待ち、回線（全部の糸で 1 本）を mbps で使う。
//! 作業場所（縮小画像・展開した画像の置き場）への書き込みは手元のディスクのまま。
//! 測る物（どれも開いた瞬間からの秒）:
//!   names      全部の画像の名前が分かる（画面にカードの枠を並べられる）
//!   screen     画面 1 枚分（45 枚。2160×1440・125%・カード 150px で 9 列 × 5 段）の縮小画像がそろう
//!   all        全部の縮小画像がそろう
//!   view       開いて 0.3 秒後に、後ろの方の画像（全体の 75% の所）を原寸で開いたとき、出るまでの秒
//!   lot2       1 つめのロットを見終えて 2 秒後に、同じ日の 2 つめのロットを開いたときの screen
//!   cache_mb   作業場所に書いた量
//!   screen_kb  画面 1 枚分の画像のために画面へ送る量
use dt_core::cab::Cab;
use dt_core::pool::Pool;
use dt_core::pyfmt::natcmp;
use dt_core::thumb;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const SCREEN: usize = 45;
const SIZE: usize = 256;

/// 共有の回線（全部の糸で 1 本）。
struct Share {
    latency: Duration,
    bytes_per_s: f64,
    busy_until: Mutex<Instant>,
}

impl Share {
    fn read(&self, p: &Path, limit: Option<usize>) -> Vec<u8> {
        std::thread::sleep(self.latency);
        let mut b = std::fs::read(p).unwrap();
        if let Some(n) = limit {
            b.truncate(n);
        }
        let dur = Duration::from_secs_f64(b.len() as f64 / self.bytes_per_s);
        let until = {
            let mut g = self.busy_until.lock().unwrap();
            let start = (*g).max(Instant::now());
            *g = start + dur;
            *g
        };
        let now = Instant::now();
        if until > now {
            std::thread::sleep(until - now);
        }
        b
    }
}

#[derive(Clone)]
struct Unit {
    path: PathBuf,
    stem: String,
}

fn units(lot: &Path) -> Vec<Unit> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(lot.join("img"))
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "cab"))
        .collect();
    v.sort_by(|a, b| natcmp(&a.to_string_lossy(), &b.to_string_lossy()));
    v.into_iter().map(|p| Unit { stem: p.file_stem().unwrap().to_string_lossy().into(), path: p }).collect()
}

/// 何がいつ済んだか。
#[derive(Default)]
struct Rec {
    t0: Option<Instant>,
    order: HashMap<String, usize>, // "stem/name" → 画面の並び
    thumbs: Mutex<Vec<(usize, f64)>>,
    names_at: Mutex<Option<f64>>,
    origs: Mutex<HashMap<String, f64>>,
    written: AtomicU64,
    cv: Condvar,
    lock: Mutex<()>,
}

impl Rec {
    fn now(&self) -> f64 {
        self.t0.unwrap().elapsed().as_secs_f64()
    }
    fn thumb(&self, key: &str) {
        let t = self.now();
        self.thumbs.lock().unwrap().push((self.order.get(key).copied().unwrap_or(usize::MAX), t));
    }
    fn orig(&self, key: &str) {
        self.origs.lock().unwrap().insert(key.to_string(), self.now());
        let _g = self.lock.lock().unwrap();
        self.cv.notify_all();
    }
    fn wait_orig(&self, key: &str) -> f64 {
        let mut g = self.lock.lock().unwrap();
        loop {
            if let Some(t) = self.origs.lock().unwrap().get(key) {
                return *t;
            }
            g = self.cv.wait_timeout(g, Duration::from_millis(5)).unwrap().0;
        }
    }
    fn screen(&self) -> Option<f64> {
        let th = self.thumbs.lock().unwrap();
        let mut got: Vec<f64> = th.iter().filter(|(i, _)| *i < SCREEN).map(|(_, t)| *t).collect();
        if got.len() < SCREEN.min(self.order.len()) {
            return None;
        }
        got.sort_by(|a, b| a.partial_cmp(b).unwrap());
        got.last().copied()
    }
    fn all(&self) -> Option<f64> {
        let th = self.thumbs.lock().unwrap();
        (th.len() >= self.order.len()).then(|| th.iter().map(|x| x.1).fold(0.0, f64::max))
    }
}

fn write(rec: &Rec, p: &Path, b: &[u8]) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, b).unwrap();
    rec.written.fetch_add(b.len() as u64, Ordering::Relaxed);
}

fn all_names(lot: &Path) -> (Vec<Unit>, Vec<(String, String)>) {
    let us = units(lot);
    let mut keys = vec![];
    for u in &us {
        let mut n = Cab::list(&u.path).unwrap().names();
        n.sort_by(|a, b| natcmp(a, b));
        keys.extend(n.into_iter().map(|n| (u.stem.clone(), n)));
    }
    (us, keys)
}

struct Ctx {
    share: Arc<Share>,
    cache: PathBuf,
    rec: Arc<Rec>,
    done: Arc<Mutex<std::collections::HashSet<String>>>,
}

/// 1 つの CAB の仕事（済んだ CAB はもう一度しない。割り込みで先に済んでいれば何もしない）。
fn unit_job(variant: &str, u: Unit, ctx: &Ctx, pool: &Arc<Pool>, pri: i64) {
    let (keep_cab, keep_orig) = (variant == "v6", !matches!(variant, "v6" | "v7"));
    let (share, cache, rec, pool2, done) = (ctx.share.clone(), ctx.cache.clone(), ctx.rec.clone(), pool.clone(), ctx.done.clone());
    pool.submit(pri, move || {
        if !done.lock().unwrap().insert(u.stem.clone()) {
            return;
        }
        let data = Arc::new(share.read(&u.path, None));
        let dir = cache.join(&u.stem);
        if keep_cab {
            write(&rec, &cache.join(format!("{}.cab", u.stem)), &data);
        }
        let c = Cab::parse(&data).unwrap();
        let mut names: Vec<String> = c.names();
        names.sort_by(|a, b| natcmp(a, b));
        let order: HashMap<String, usize> = names.iter().enumerate().map(|(i, n)| (n.clone(), i)).collect();
        c.extract(&data, &mut |e, b| {
            let key = format!("{}/{}", u.stem, e.name);
            if keep_orig {
                write(&rec, &dir.join(&e.name), b);
            }
            rec.orig(&key);
            // 縮小は 1 枚ずつ芯へ（画面の並びが前ほど先）
            let (b, rec2, dir2, name, stem) = (b.to_vec(), rec.clone(), dir.clone(), e.name.clone(), u.stem.clone());
            let p = pri - 1 - order[&e.name] as i64;
            pool2.submit(p, move || {
                write(&rec2, &dir2.join(".thumb").join(format!("{name}.jpg")), &thumb::thumb_bytes(&b, SIZE).unwrap());
                rec2.thumb(&format!("{stem}/{name}"));
            });
            Ok(())
        })
        .unwrap();
    });
}

/// 案ごとの開き方。ロットを開いて、裏の仕事を並べる（戻ったら画面は待つだけ）。
fn open(variant: &str, lot: &Path, ctx: &Ctx, pool: &Arc<Pool>) {
    let (us, _) = all_names(lot);
    let rec = ctx.rec.clone();
    match variant {
        // 版 3.8 と同じ流れ（CAB ごとに展開してディスクへ・読み直して縮小）。糸 4 本
        "v1" => {
            *rec.names_at.lock().unwrap() = None;
            for u in us {
                let (share, cache, rec) = (ctx.share.clone(), ctx.cache.clone(), rec.clone());
                pool.submit(0, move || {
                    let data = share.read(&u.path, None);
                    let c = Cab::parse(&data).unwrap();
                    let dir = cache.join(&u.stem);
                    let mut names = vec![];
                    c.extract(&data, &mut |e, b| {
                        write(&rec, &dir.join(&e.name), b);
                        rec.orig(&format!("{}/{}", u.stem, e.name));
                        names.push(e.name.clone());
                        Ok(())
                    })
                    .unwrap();
                    let mut nm = rec.names_at.lock().unwrap();
                    *nm = Some(nm.unwrap_or(0.0).max(rec.now()));
                    drop(nm);
                    for n in names {
                        let b = std::fs::read(dir.join(&n)).unwrap();
                        write(&rec, &dir.join(".thumb").join(format!("{n}.jpg")), &thumb::thumb_bytes(&b, SIZE).unwrap());
                        rec.thumb(&format!("{}/{}", u.stem, n));
                    }
                });
            }
        }
        // メモリで一度に（CAB を 1 回で読み、伸ばしながら原寸と縮小画像を書く）。糸は芯の数
        "v2" | "v4" => {
            let thumbs = variant == "v2";
            for u in us {
                let (share, cache, rec) = (ctx.share.clone(), ctx.cache.clone(), rec.clone());
                pool.submit(0, move || {
                    let data = share.read(&u.path, None);
                    let c = Cab::parse(&data).unwrap();
                    let dir = cache.join(&u.stem);
                    c.extract(&data, &mut |e, b| {
                        write(&rec, &dir.join(&e.name), b);
                        let key = format!("{}/{}", u.stem, e.name);
                        rec.orig(&key);
                        if thumbs {
                            write(&rec, &dir.join(".thumb").join(format!("{}.jpg", e.name)), &thumb::thumb_bytes(b, SIZE).unwrap());
                        }
                        rec.thumb(&key); // v4 は原寸をそのまま画面へ（縮小画像を作らない）
                        Ok(())
                    })
                    .unwrap();
                });
            }
        }
        // 見ている所から（名前を先に・画面の並びの順・縮小画像は 1 枚ずつ芯へ配る・原寸を開いたらその CAB を最優先へ割り込む）
        // v6 は置き場を変える: 原寸を展開せず CAB のまま手元に写し、原寸は開いたときにメモリで伸ばす
        // v7 は縮小画像だけを持つ: 原寸は開いたときに共有の CAB を読み直してメモリで伸ばす
        "v3" | "v5" | "v6" | "v7" => {
            for (ui, u) in us.into_iter().enumerate() {
                unit_job(variant, u, ctx, pool, 100_000 - ui as i64 * 1000);
            }
        }
        _ => panic!("知らない案 {variant}"),
    }
}

fn run(variant: &str, lot: &Path, lot2: &Path, share: Arc<Share>, work: &Path) -> serde_json::Value {
    let cache = work.join(variant);
    let _ = std::fs::remove_dir_all(&cache);
    let threads = if variant == "v1" { 4 } else { std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) };
    let pool = Arc::new(Pool::new(threads, variant));
    let mut out = json!({"variant": variant, "threads": threads});
    for (k, l) in [("lot1", lot), ("lot2", lot2)] {
        let (_, keys) = all_names(l);
        let view = keys[keys.len() * 3 / 4].clone();
        let view_key = format!("{}/{}", view.0, view.1);
        let mut rec = Rec { t0: Some(Instant::now()), ..Default::default() };
        rec.order = keys.iter().enumerate().map(|(i, (s, n))| (format!("{s}/{n}"), i)).collect();
        let rec = Arc::new(rec);
        let ctx = Ctx { share: share.clone(), cache: cache.join(k), rec: rec.clone(), done: Arc::default() };
        // 名前: v1・v2・v4 は CAB を展開し終えるまで分からない（版 3.8 と同じく展開してから一覧）。v3 からは頭だけ読んで先に
        if matches!(variant, "v3" | "v5" | "v6" | "v7") {
            let us = units(l);
            std::thread::scope(|s| {
                for u in &us {
                    let sh = share.clone();
                    s.spawn(move || sh.read(&u.path, Some(4096)));
                }
            });
            *rec.names_at.lock().unwrap() = Some(rec.now());
        }
        let prefetched = k == "lot2" && variant == "v5";
        let vstart;
        if prefetched {
            // 1 つめを見終えた後の空き時間に、同じ日の次のロットを裏で用意しておいた（その間は測らない）
            let pre = Arc::new(Rec { t0: Some(Instant::now()), order: rec.order.clone(), ..Default::default() });
            open(variant, l, &Ctx { share: share.clone(), cache: cache.join(k), rec: pre.clone(), done: Arc::default() }, &pool);
            pool.wait_idle();
            let mut r2 = Rec { t0: Some(Instant::now()), ..Default::default() };
            r2.order = rec.order.clone();
            // 用意済み: 開くのは置き場の縮小画像を読むだけ
            let r2 = Arc::new(r2);
            *r2.names_at.lock().unwrap() = Some(r2.now());
            for key in rec.order.keys() {
                r2.thumb(key);
                r2.orig(key);
            }
            vstart = r2.now();
            let v = r2.wait_orig(&view_key) - vstart;
            out[k] = json!({"names": r2.names_at.lock().unwrap().map(round3), "screen": r2.screen().map(round3), "all": r2.all().map(round3),
                            "view": round3(v.max(0.0)), "cache_mb": round3(pre.written.load(Ordering::Relaxed) as f64 / 1e6)});
            continue;
        }
        open(variant, l, &ctx, &pool);
        // 0.3 秒後に原寸を開く（v3 からは、その CAB を最優先で割り込ませる）
        std::thread::sleep(Duration::from_millis(300));
        vstart = rec.now();
        if matches!(variant, "v3" | "v5" | "v6") {
            unit_job(variant, Unit { path: l.join("img").join(format!("{}.cab", view.0)), stem: view.0.clone() }, &ctx, &pool, 1_000_000);
        }
        let v = if variant == "v7" {
            // 共有の CAB を読み直してメモリで伸ばす（裏の読み込みと回線を分け合う）
            let t1 = Instant::now();
            let data = share.read(&l.join("img").join(format!("{}.cab", view.0)), None);
            let c = Cab::parse(&data).unwrap();
            c.extract(&data, &mut |e, _b| if e.name == view.1 { Err(std::io::Error::other("found")) } else { Ok(()) }).ok();
            t1.elapsed().as_secs_f64()
        } else if variant == "v6" {
            // CAB のまま持つ案: その CAB の写しが手元に来ていればメモリで伸ばす（来ていなければ共有から読んで伸ばす）
            let t = rec.wait_orig(&view_key).max(vstart);
            let unit = cache.join(k).join(format!("{}.cab", view.0));
            let t1 = Instant::now();
            let data = std::fs::read(&unit).unwrap_or_else(|_| share.read(&l.join("img").join(format!("{}.cab", view.0)), None));
            let c = Cab::parse(&data).unwrap();
            c.extract(&data, &mut |e, _b| if e.name == view.1 { Err(std::io::Error::other("found")) } else { Ok(()) }).ok();
            t - vstart + t1.elapsed().as_secs_f64()
        } else {
            (rec.wait_orig(&view_key) - vstart).max(0.0)
        };
        pool.wait_idle();
        let names = rec.names_at.lock().unwrap().or(rec.all());
        let screen_kb = if variant == "v4" {
            let first: Vec<&String> = rec.order.iter().filter(|(_, i)| **i < SCREEN).map(|(k, _)| k).collect();
            first.iter().map(|k| std::fs::metadata(cache.join("lot1").join(k)).map(|m| m.len()).unwrap_or(0)).sum::<u64>() as f64 / 1e3
        } else {
            let first: Vec<&String> = rec.order.iter().filter(|(_, i)| **i < SCREEN).map(|(k, _)| k).collect();
            first
                .iter()
                .map(|k| {
                    let (s, n) = k.split_once('/').unwrap();
                    std::fs::metadata(cache.join(k_of(k)).join(s).join(".thumb").join(format!("{n}.jpg"))).map(|m| m.len()).unwrap_or(0)
                })
                .sum::<u64>() as f64
                / 1e3
        };
        out[k] = json!({"names": names.map(round3), "screen": rec.screen().map(round3), "all": rec.all().map(round3), "view": round3(v),
                        "cache_mb": round3(rec.written.load(Ordering::Relaxed) as f64 / 1e6), "screen_kb": round3(screen_kb)});
        if k == "lot1" {
            std::thread::sleep(Duration::from_secs(2));
        }
    }
    out
}

fn k_of(_k: &str) -> &'static str {
    "lot1"
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |n: &str, d: &str| args.iter().position(|a| a == n).and_then(|i| args.get(i + 1)).cloned().unwrap_or_else(|| d.to_string());
    let (lot, lot2) = (PathBuf::from(&args[1]), PathBuf::from(&args[2]));
    let share = Arc::new(Share {
        latency: Duration::from_secs_f64(arg("--latency-ms", "3").parse::<f64>().unwrap() / 1000.0),
        bytes_per_s: arg("--mbps", "110").parse::<f64>().unwrap() * 1e6,
        busy_until: Mutex::new(Instant::now()),
    });
    let work = std::env::temp_dir().join(format!("dt-imgbench-{}", std::process::id()));
    let vs = arg("--variant", "all");
    let list: Vec<&str> = if vs == "all" { vec!["v1", "v2", "v3", "v4", "v5", "v6", "v7"] } else { vs.split(',').collect() };
    for v in list {
        let r = run(v, &lot, &lot2, share.clone(), &work);
        println!("{r}");
    }
    let _ = std::fs::remove_dir_all(&work);
}
