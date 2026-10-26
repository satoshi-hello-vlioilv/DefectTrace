//! 欠陥の並びの解析: 転写候補（表と裏で幅方向位置が近い組）とピッチ候補（同じ面・同じ幅位置で等間隔に並ぶ列）。
//! 版 3.8 の Python 版（api_pairs・find_pitches）と同じ答え（tests/golden.rs が確かめる）。

use crate::dat::{Dat, V};
use crate::lot::{py_str, LotRes};
use crate::pyfmt::round_to;
use serde_json::{json, Value};
use std::collections::HashMap;

/// 欠陥 1 つ（解析に使う数と、画面へ返す形）。
#[derive(Debug, Clone)]
pub struct Defect {
    pub i: usize,
    pub side: String,
    pub group: Option<i64>,
    pub x: f64,
    pub y: f64,
    pub w: Option<f64>,
    pub json: Value,
}

fn base(d: &Dat, res: &LotRes, i: usize, x: f64, y: f64, rev: &HashMap<usize, String>) -> Value {
    let r = &d.records[i];
    let g = |k: &str| d.get(r, k).cloned().unwrap_or(V::Null);
    let k = res.kind_info(d.get(r, "kindID"));
    json!({"i": i, "no": g("detectNo").to_json(), "side": g("group").to_json(), "x": round_to(x, 2), "y": y,
           "a": match g("area_mm") { V::I(a) => json!(a), v => json!(round_to(v.num().unwrap_or(0.0), 2)) },
           "kind": g("kindID").to_json(), "kname": k.name, "kmark": k.mark, "kcolor": k.color, "img": rev.get(&i)})
}

fn is_defect(d: &Dat, r: &crate::dat::Rec) -> bool {
    d.get(r, "type").map(|t| t.int() == Some(1)).unwrap_or(true)
}

fn sub(d: &Dat, r: &crate::dat::Rec, a: &str, b: &str) -> Option<f64> {
    Some(d.get(r, a)?.num()? - d.get(r, b)?.num()?)
}

/// 表と裏の組（幅方向位置の差が tol mm 以内・長さの差が maxdy m 以内）。rev: 欠陥の番号 → 画像（"cab/name"）。
pub fn pairs(res: &LotRes, rev: &HashMap<usize, String>, tol: f64, maxdy: Option<f64>, mirror: bool) -> Value {
    let det = res.dat("DETECT_INFO");
    let sides = res.sides();
    let fg = sides.iter().find(|(_, s)| s.name.contains('表')).map(|(i, _)| *i).unwrap_or(1);
    let bg = sides.iter().find(|(_, s)| s.name.contains('裏')).map(|(i, _)| *i).unwrap_or(0);
    let (mut defects, mut f, mut b) = (vec![], vec![], vec![]);
    for (i, r) in det.records.iter().enumerate() {
        if !is_defect(&det, r) {
            continue;
        }
        let Some(x) = sub(&det, r, "x_mm", "base_x") else { continue };
        let width = sub(&det, r, "x_end", "base_x");
        let y = round_to(det.get(r, "y_mm").and_then(V::num).unwrap_or(0.0) / 1000.0, 3);
        let mut j = base(&det, res, i, x, y, rev);
        j["w"] = match width {
            Some(w) if w != 0.0 => json!(round_to(w, 2)),
            _ => Value::Null,
        };
        let group = det.get(r, "group").and_then(V::int);
        let d = Defect { i, side: String::new(), group, x: round_to(x, 2), y, w: j["w"].as_f64(), json: j };
        defects.push(d.json.clone());
        if group == Some(fg) {
            f.push(d);
        } else if group == Some(bg) {
            b.push(d);
        }
    }
    let bx = |d: &Defect| match d.w {
        Some(w) if mirror && w != 0.0 => w - d.x,
        _ => d.x,
    };
    b.sort_by(|p, q| bx(p).partial_cmp(&bx(q)).unwrap_or(std::cmp::Ordering::Equal));
    let bxs: Vec<f64> = b.iter().map(bx).collect();
    let mut out: Vec<Value> = vec![];
    for fd in &f {
        let lo = bxs.partition_point(|v| *v < fd.x - tol);
        let hi = bxs.partition_point(|v| *v <= fd.x + tol);
        for bd in &b[lo..hi.max(lo)] {
            let dy = bd.y - fd.y;
            if maxdy.is_some_and(|m| dy.abs() > m) {
                continue;
            }
            out.push(json!([fd.i, bd.i, round_to(bx(bd) - fd.x, 2), round_to(dy, 3)]));
        }
        if out.len() >= 50000 {
            break;
        }
    }
    let scan = &res.system().scan;
    let (sf, sb) = (scan.get(&fg), scan.get(&bg));
    json!({"ok": true, "defects": defects, "pairs": out, "front": fg, "back": bg, "tol": tol, "mirror": mirror,
           "sides": res.sides_json(), "nf": f.len(), "nb": b.len(),
           "scan": {"front": sf.cloned().flatten(), "back": sb.cloned().flatten(), "known": sf.is_some() && sb.is_some(), "same": sf == sb}})
}

/// ピッチを探す条件。
#[derive(Debug, Clone, Copy)]
pub struct PitchCond {
    pub tol: f64,
    pub ytol: f64,
    pub min_n: usize,
    pub pmin: f64,
    pub pmax: Option<f64>,
    pub skip: usize,
}

/// 見つけた列（面・欠陥・ピッチ・欠けの数）。
pub struct Chain<'a> {
    pub side: String,
    pub members: Vec<&'a Defect>,
    pub pitch: f64,
    pub gaps: Vec<usize>,
}

/// 同じ面で、幅方向位置が列の平均から ±tol mm、間隔がピッチの ±ytol m、間隔が min_n 以上の列。
/// skip: 途中の欠け（ピッチの 2〜4 倍の間隔）を何回まで許すか。
pub fn find_pitches<'a>(items: &'a [Defect], c: PitchCond, cap: usize) -> Vec<Chain<'a>> {
    let mut order: Vec<String> = vec![];
    let mut by: HashMap<String, Vec<&Defect>> = HashMap::new();
    for d in items {
        if !by.contains_key(&d.side) {
            order.push(d.side.clone());
        }
        by.entry(d.side.clone()).or_default().push(d);
    }
    let mut found: Vec<(String, Vec<&Defect>, f64, Vec<usize>)> = vec![];
    for side in &order {
        let l = by.get_mut(side).unwrap();
        l.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal));
        let l: &Vec<&Defect> = l;
        let ys: Vec<f64> = l.iter().map(|d| d.y).collect();
        let n = l.len();
        let near = |y: f64, x0: f64, excl: &[usize]| -> Option<usize> {
            let lo = ys.partition_point(|v| *v < y - c.ytol);
            let hi = ys.partition_point(|v| *v <= y + c.ytol);
            let mut best: Option<(f64, usize)> = None;
            for k in lo..hi.max(lo) {
                if excl.contains(&k) || (l[k].x - x0).abs() > c.tol {
                    continue;
                }
                let e = (ys[k] - y).abs() + (l[k].x - x0).abs() * 1e-5;
                if best.is_none_or(|(b, _)| e < b) {
                    best = Some((e, k));
                }
            }
            best.map(|(_, k)| k)
        };
        'outer: for a in 0..n {
            let (xa, ya) = (l[a].x, ys[a]);
            let hi = match c.pmax {
                None => n,
                Some(pm) => ys.partition_point(|v| *v <= ya + pm + c.ytol),
            };
            let start = ys.partition_point(|v| *v < ya + c.pmin);
            for bi in start..hi.max(start) {
                if (l[bi].x - xa).abs() > c.tol {
                    continue;
                }
                let p = ys[bi] - ya;
                if near(ya - p, xa, &[]).is_some() {
                    continue;
                }
                let (mut mem, mut gaps, mut pm) = (vec![a, bi], vec![1usize], p);
                let mut xm = (xa + l[bi].x) / 2.0;
                loop {
                    let mut nxt = None;
                    for mlt in 1..=c.skip + 1 {
                        if let Some(k) = near(ys[*mem.last().unwrap()] + pm * mlt as f64, xm, &mem) {
                            nxt = Some((k, mlt));
                            break;
                        }
                    }
                    let Some((k, mlt)) = nxt else { break };
                    mem.push(k);
                    gaps.push(mlt);
                    pm = (ys[k] - ya) / gaps.iter().sum::<usize>() as f64;
                    xm = mem.iter().map(|&k| l[k].x).sum::<f64>() / mem.len() as f64;
                }
                if mem.len() > c.min_n {
                    found.push((side.clone(), mem.iter().map(|&k| l[k]).collect(), pm, gaps));
                }
                if found.len() >= cap {
                    break;
                }
            }
            if found.len() >= cap {
                break 'outer;
            }
        }
    }
    found.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.1[0].y.partial_cmp(&b.1[0].y).unwrap_or(std::cmp::Ordering::Equal)));
    let mut kept: Vec<(String, std::collections::HashSet<usize>, Chain)> = vec![];
    for (side, mem, pm, gaps) in found {
        let s: std::collections::HashSet<usize> = mem.iter().map(|d| d.i).collect();
        if kept.iter().any(|k| k.0 == side && s.is_subset(&k.1)) {
            continue;
        }
        kept.push((side.clone(), s, Chain { side, members: mem, pitch: pm, gaps }));
    }
    kept.into_iter().map(|k| k.2).collect()
}

/// ピッチ候補（画面の答え）。
pub fn pitch(res: &LotRes, rev: &HashMap<usize, String>, c: PitchCond) -> Value {
    let det = res.dat("DETECT_INFO");
    let mut items = vec![];
    for (i, r) in det.records.iter().enumerate() {
        if !is_defect(&det, r) {
            continue;
        }
        let (Some(x), Some(y)) = (sub(&det, r, "x_mm", "base_x"), det.get(r, "y_mm").and_then(V::num)) else { continue };
        let y = round_to(y / 1000.0, 4);
        let j = base(&det, res, i, x, y, rev);
        let group = det.get(r, "group");
        items.push(Defect {
            i,
            side: group.map(py_str).unwrap_or_else(|| "None".into()),
            group: group.and_then(V::int),
            x: round_to(x, 2),
            y,
            w: None,
            json: j,
        });
    }
    let chains: Vec<Value> = find_pitches(&items, c, 3000)
        .into_iter()
        .map(|ch| {
            let mem = &ch.members;
            let iv: Vec<f64> = (0..mem.len() - 1).map(|j| round_to(mem[j + 1].y - mem[j].y, 4)).collect();
            let dev = (0..iv.len()).map(|j| (iv[j] - ch.pitch * ch.gaps[j] as f64).abs()).fold(f64::MIN, f64::max);
            let xs: Vec<f64> = mem.iter().map(|d| d.x).collect();
            let (mn, mx) = xs.iter().fold((f64::MAX, f64::MIN), |(a, b), &x| (a.min(x), b.max(x)));
            json!({"side": mem[0].json["side"], "pitch": round_to(ch.pitch, 4), "n": mem.len(), "intervals": iv, "gaps": ch.gaps,
                   "dev": round_to(dev, 4), "x": round_to(xs.iter().sum::<f64>() / xs.len() as f64, 2), "xr": round_to(mx - mn, 2),
                   "y0": mem[0].y, "y1": mem[mem.len() - 1].y, "dia": round_to(ch.pitch * 1000.0 / std::f64::consts::PI, 1),
                   "members": mem.iter().map(|d| d.json.clone()).collect::<Vec<_>>()})
        })
        .collect();
    json!({"ok": true, "chains": chains, "sides": res.sides_json(),
           "cond": {"tol": c.tol, "ytol": c.ytol, "n": c.min_n, "pmin": c.pmin, "pmax": c.pmax, "skip": c.skip}})
}
