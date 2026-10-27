//! 作った画像の読み込み（dt_core::images。v7 に決めて作った物）を、画面と同じ問い合わせで測る（作った後の評価関数）。
//!
//!     cargo run --release --example openbench -- <ロット> [--runs 3]
//!
//! 画面を真似る: 開いて（/api/open）、画面 1 枚分（45 枚）の縮小画像を 6 本ずつ並べて頼み（ブラウザが 1 つの相手に並べる数）、
//! 0.3 秒後に後ろの方（75% の所）の画像を原寸で開き、続けて同じ CAB の次の画像を開く。作業場所は毎回まっさら。
//!   open    /api/open が返る（画面が読み込みの進みを出し始められる）
//!   names   /api/status が全部の名前を返す（カードの枠と数を出せる）
//!   screen  画面 1 枚分の縮小画像が届く
//!   all     全部の縮小画像ができる（/api/status の finished）
//!   view    原寸が届く（開いて 0.3 秒後に頼んでから）
//!   next    同じ CAB の次の原寸が届く（覚えた CAB から）
//!   cold    全部済んだあとに、先頭の CAB（覚えから外れた物）の原寸が届く（CAB を読み直して伸ばす）
//!   done_ok finished が立ったとき、縮小画像が全部そろっているか（そろう前に「済んだ」と見せない）
//!   cache_mb 作業場所に書いた量・rss_mb この糸の最大メモリ（Linux の VmHWM）
use dt_core::app::App;
use dt_core::config::Config;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn q(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| {
            let e: String = v
                .bytes()
                .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
                .collect();
            format!("{k}={e}")
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn size_of(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| if e.path().is_dir() { size_of(&e.path()) } else { e.metadata().map(|m| m.len()).unwrap_or(0) })
        .sum()
}

fn once(lot: &str, home: &Path) -> Value {
    let _ = std::fs::remove_dir_all(home);
    let app = App::new(Config::from_value(json!({}), home), None);
    let t0 = Instant::now();
    let body = serde_json::to_vec(&json!({"lot": lot})).unwrap();
    app.handle("POST", "/api/open", "", &body).unwrap();
    let opened = t0.elapsed().as_secs_f64();
    // 名前は裏で読む（開くは待たせない）。全部の名前が分かるまで問い続ける（画面の問い合わせと同じ）
    let st: Value = loop {
        let st: Value = serde_json::from_slice(&app.handle("GET", "/api/status", &q(&[("lot", lot)]), &[]).unwrap().body).unwrap();
        if st["named"] == true {
            break st;
        }
        std::thread::sleep(Duration::from_millis(2));
    };
    let names = t0.elapsed().as_secs_f64();
    let all_imgs: Vec<(String, String, String)> = st["cabs"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| {
            let (g, cab) = (c["group"].as_str().unwrap().to_string(), c["cab"].as_str().unwrap().to_string());
            c["images"]
                .as_array()
                .unwrap()
                .iter()
                .map(move |n| (g.clone(), cab.clone(), n.as_str().unwrap().to_string()))
                .collect::<Vec<_>>()
        })
        .collect();
    let screen: Vec<_> = all_imgs.iter().take(45).cloned().collect();
    let view = all_imgs[all_imgs.len() * 3 / 4].clone();
    let next = all_imgs[all_imgs.len() * 3 / 4 + 1].clone();
    let (screen_t, view_t, next_t) = std::thread::scope(|s| {
        let app2 = &app;
        let sc = s.spawn(move || {
            let chunks: Vec<Vec<_>> = (0..6).map(|i| screen.iter().skip(i).step_by(6).cloned().collect()).collect();
            std::thread::scope(|s2| {
                for ch in chunks {
                    s2.spawn(move || {
                        for (g, cab, n) in ch {
                            let r = app2.handle("GET", "/thumb", &q(&[("lot", lot), ("g", &g), ("cab", &cab), ("name", &n)]), &[]).unwrap();
                            assert_eq!(r.status, 200);
                        }
                    });
                }
            });
            t0.elapsed().as_secs_f64()
        });
        std::thread::sleep(Duration::from_millis(300));
        let t1 = Instant::now();
        let r = app.handle("GET", "/img", &q(&[("lot", lot), ("g", &view.0), ("cab", &view.1), ("name", &view.2)]), &[]).unwrap();
        assert_eq!(r.status, 200);
        let v = t1.elapsed().as_secs_f64();
        let t2 = Instant::now();
        let r = app.handle("GET", "/img", &q(&[("lot", lot), ("g", &next.0), ("cab", &next.1), ("name", &next.2)]), &[]).unwrap();
        assert_eq!(r.status, 200);
        (sc.join().unwrap(), v, t2.elapsed().as_secs_f64())
    });
    let (all, done_ok) = loop {
        let st: Value = serde_json::from_slice(&app.handle("GET", "/api/status", &q(&[("lot", lot)]), &[]).unwrap().body).unwrap();
        if st["finished"] == true {
            break (t0.elapsed().as_secs_f64(), st["thumbs"] == st["thumbs_total"]);
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let first = all_imgs[0].clone();
    let t3 = Instant::now();
    let r = app.handle("GET", "/img", &q(&[("lot", lot), ("g", &first.0), ("cab", &first.1), ("name", &first.2)]), &[]).unwrap();
    assert_eq!(r.status, 200);
    let cold = t3.elapsed().as_secs_f64();
    let rss = std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|t| {
            t.lines().find(|l| l.starts_with("VmHWM")).and_then(|l| l.split_whitespace().nth(1)).and_then(|k| k.parse::<f64>().ok())
        })
        .map(|k| k / 1024.0);
    let r3 = |x: f64| (x * 1000.0).round() / 1000.0;
    json!({"open": r3(opened), "names": r3(names), "screen": r3(screen_t), "all": r3(all), "view": r3(view_t), "next": r3(next_t), "cold": r3(cold), "done_ok": done_ok, "rss_mb": rss.map(|x| x.round()),
           "cache_mb": r3(size_of(&home.join("cache")) as f64 / 1e6), "images": all_imgs.len(), "workers": app.cfg.workers()})
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let lot = std::fs::canonicalize(&args[1]).unwrap().display().to_string();
    let runs: usize = args.iter().position(|a| a == "--runs").and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(3);
    let home: PathBuf = std::env::temp_dir().join(format!("dt-openbench-{}", std::process::id()));
    for _ in 0..runs {
        println!("{}", once(&lot, &home));
    }
    let _ = std::fs::remove_dir_all(&home);
}
