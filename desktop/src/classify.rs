//! 画像の仕分け（グループの見本 3 枚以上から、振り分けの条件を割り出して当てる）と、計測の物差しの推定。
//!
//! 特徴は 2 つの出どころから作る（どちらも決め打ちしない）:
//! - 画像: 明るさの平均・ばらつき、欠陥（周りより暗い／明るいまとまりのうち、いちばん大きい物）の面積・幅・長さ・細長さ・向き・
//!   詰まり具合・周りとの差・明暗、まとまりの数、輪郭の強さ
//! - 欠陥データ（DETECT_INFO）: 数の欄すべて。1 件ごとに違う整数の欄（欠陥No・画像ID など）と、どの件も同じ欄は除く。
//!   種類の少ない整数の欄（分類・面・カメラ など）は「分類の欄」として、範囲ではなく値の組で扱う
//!
//! 条件の割り出し（学習）: 見本（3 枚以上）がロット全体に比べてまとまっている特徴を、条件の候補にする（見本の範囲に少し余裕を足した範囲。
//! 分類の欄は見本の値の組）。候補から、足すたびに「当てはまる画像」がいちばん減る物を順に選ぶ（ほかのグループの見本が当てはまるほど
//! 減点）。減り方が小さくなったら止める（4 つまで）。決め方が人に読めるように、条件は「特徴・範囲・ロットの何割が入るか」で返す。
//! 当てる: 条件をすべて満たす画像を「当てはまる」、1 つだけ外れる画像を「近い」とする。並びは見本の中心への近さ。

use crate::thumb::Raster;
use serde_json::{json, Value};

/// 特徴 1 つの定義。
#[derive(Debug, Clone)]
pub struct FeatDef {
    pub key: String,
    pub label: String,
    /// 分類の欄（値の組で扱う）か
    pub cat: bool,
}

/// 画像から計算する特徴（並びと名前）。
pub const IMG_FEATS: [(&str, &str); 12] = [
    ("img:mean", "明るさの平均"),
    ("img:std", "明るさのばらつき"),
    ("img:contrast", "欠陥の濃さ（周りとの差）"),
    ("img:polarity", "欠陥の明暗（暗い −1・明るい +1）"),
    ("img:area", "欠陥の面積(px)"),
    ("img:w", "欠陥の幅(px)"),
    ("img:h", "欠陥の長さ(px)"),
    ("img:elong", "細長さ（長軸 ÷ 短軸）"),
    ("img:angle", "向き（横 0〜縦 90 度）"),
    ("img:fill", "詰まり具合（面積 ÷ 囲む四角）"),
    ("img:count", "まとまりの数"),
    ("img:edge", "輪郭の強さ"),
];

/// 欠陥（いちばん大きなまとまり）。
#[derive(Debug, Clone, Default)]
pub struct Blob {
    pub area: usize,
    pub x0: usize,
    pub y0: usize,
    pub x1: usize,
    pub y1: usize,
    pub mean: f64,
    pub polarity: f64,
    pub elong: f64,
    pub angle: f64,
}

impl Blob {
    pub fn w(&self) -> usize {
        self.x1 - self.x0 + 1
    }
    pub fn h(&self) -> usize {
        self.y1 - self.y0 + 1
    }
}

/// 画像の特徴（IMG_FEATS の並び）と、欠陥のまとまり（あれば）。
pub struct ImageFeat {
    pub vals: Vec<Option<f64>>,
    pub blob: Option<Blob>,
}

fn gray(r: &Raster) -> Vec<u8> {
    if r.ch == 1 {
        return r.px.clone();
    }
    r.px.chunks(r.ch).map(|p| ((p[0] as u32 + p[1] as u32 + p[2] as u32) / 3) as u8).collect()
}

/// 明るさの分布の分位（0〜1）。
fn quantile(hist: &[u64; 256], n: u64, q: f64) -> f64 {
    let target = (q * n as f64).ceil().max(1.0) as u64;
    let mut acc = 0;
    for (v, c) in hist.iter().enumerate() {
        acc += c;
        if acc >= target {
            return v as f64;
        }
    }
    255.0
}

/// 画像の特徴を計算する。
pub fn image_features(r: &Raster) -> ImageFeat {
    let (w, h) = (r.w, r.h);
    let g = gray(r);
    let n = (w * h) as u64;
    if w < 3 || h < 3 || g.len() < w * h {
        return ImageFeat { vals: vec![None; IMG_FEATS.len()], blob: None };
    }
    let mut hist = [0u64; 256];
    let (mut sum, mut sum2) = (0f64, 0f64);
    for &v in &g {
        hist[v as usize] += 1;
        sum += v as f64;
        sum2 += (v as f64) * (v as f64);
    }
    let mean = sum / n as f64;
    let std = (sum2 / n as f64 - mean * mean).max(0.0).sqrt();
    // 地（周り）: 中央値と、四分位の幅から見たばらつき（欠陥が大きくても地の値がぶれにくい）
    let bg = quantile(&hist, n, 0.5);
    let sigma = ((quantile(&hist, n, 0.75) - quantile(&hist, n, 0.25)) / 1.35).max(4.0);
    let thr = (3.0 * sigma).max(12.0);
    // まとまり（4 近傍）。暗い所と明るい所を別に数え、小さすぎる物（ざらつき）は除く
    let min_area = ((w * h) as f64 * 0.0005).max(4.0) as usize;
    let mut label = vec![0u8; w * h];
    let mut best: Option<Blob> = None;
    let mut count = 0usize;
    let mut stack = vec![];
    for start in 0..w * h {
        let v = g[start] as f64;
        let pol = if v < bg - thr {
            -1.0
        } else if v > bg + thr {
            1.0
        } else {
            continue;
        };
        if label[start] != 0 {
            continue;
        }
        label[start] = 1;
        stack.push(start);
        let (mut area, mut s, mut sx, mut sy, mut sxx, mut syy, mut sxy) = (0usize, 0f64, 0f64, 0f64, 0f64, 0f64, 0f64);
        let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            area += 1;
            s += g[i] as f64;
            let (fx, fy) = (x as f64, y as f64);
            sx += fx;
            sy += fy;
            sxx += fx * fx;
            syy += fy * fy;
            sxy += fx * fy;
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
            let mut push = |j: usize| {
                let vj = g[j] as f64;
                let same = if pol < 0.0 { vj < bg - thr } else { vj > bg + thr };
                if same && label[j] == 0 {
                    label[j] = 1;
                    stack.push(j);
                }
            };
            if x > 0 {
                push(i - 1);
            }
            if x + 1 < w {
                push(i + 1);
            }
            if y > 0 {
                push(i - w);
            }
            if y + 1 < h {
                push(i + w);
            }
        }
        if area < min_area {
            continue;
        }
        count += 1;
        if best.as_ref().is_some_and(|b| b.area >= area) {
            continue;
        }
        let a = area as f64;
        let (mx, my) = (sx / a, sy / a);
        // 二次の積率 → 長軸・短軸（細長さ）と向き。1 画素の幅でも 0 にならないよう 1/12 を足す
        let (cxx, cyy, cxy) = (sxx / a - mx * mx + 1.0 / 12.0, syy / a - my * my + 1.0 / 12.0, sxy / a - mx * my);
        let tr = cxx + cyy;
        let det = cxx * cyy - cxy * cxy;
        let disc = (tr * tr / 4.0 - det).max(0.0).sqrt();
        let (l1, l2) = (tr / 2.0 + disc, (tr / 2.0 - disc).max(1e-9));
        let angle = (0.5 * (2.0 * cxy).atan2(cxx - cyy)).to_degrees().abs();
        best = Some(Blob { area, x0, y0, x1, y1, mean: s / a, polarity: pol, elong: (l1 / l2).sqrt(), angle: angle.min(180.0 - angle) });
    }
    // 輪郭の強さ: 隣どうしの差の平均
    let mut edge = 0f64;
    for y in 0..h - 1 {
        for x in 0..w - 1 {
            let i = y * w + x;
            edge += (g[i] as f64 - g[i + 1] as f64).abs() + (g[i] as f64 - g[i + w] as f64).abs();
        }
    }
    let edge = edge / ((w - 1) * (h - 1)) as f64;
    let b = best.clone();
    let vals = vec![
        Some(mean),
        Some(std),
        b.as_ref().map(|b| (b.mean - bg).abs()),
        b.as_ref().map(|b| b.polarity),
        b.as_ref().map(|b| b.area as f64),
        b.as_ref().map(|b| b.w() as f64),
        b.as_ref().map(|b| b.h() as f64),
        b.as_ref().map(|b| b.elong),
        b.as_ref().map(|b| b.angle),
        b.as_ref().map(|b| b.area as f64 / (b.w() * b.h()) as f64),
        Some(count as f64),
        Some(edge),
    ];
    ImageFeat { vals, blob: best }
}

/// 欠陥データの欄を特徴として使うか・分類の欄か。values は全件の値（数でない物は None）。
/// → None なら使わない（どの件も同じ・1 件ごとに違う整数〈番号〉）。Some(true) なら分類の欄
pub fn data_feature_kind(values: &[Option<f64>]) -> Option<bool> {
    let xs: Vec<f64> = values.iter().flatten().copied().collect();
    if xs.len() < 3 {
        return None;
    }
    let ints = xs.iter().all(|x| x.fract() == 0.0);
    let mut d: Vec<i64> = xs.iter().map(|x| (x * 1e6).round() as i64).collect();
    d.sort_unstable();
    d.dedup();
    if d.len() <= 1 {
        return None; // どの件も同じ
    }
    if ints && d.len() == xs.len() && xs.len() >= 5 {
        return None; // 1 件ごとに違う整数（欠陥No・画像ID など）
    }
    Some(ints && d.len() <= 12)
}

/// 条件 1 つ。
#[derive(Debug, Clone)]
pub struct Rule {
    pub feat: usize,
    /// 数の欄: 範囲（両端を含む）
    pub lo: f64,
    pub hi: f64,
    /// 分類の欄: 値の組
    pub set: Vec<f64>,
    /// ロット全体のうち、この条件に入る割合（0〜1）
    pub cover: f64,
    /// 余白: 範囲の外のいちばん近い画像までの距離 ÷ ロット全体の広がり（大きいほど境目に余裕がある）
    pub gap: f64,
}

impl Rule {
    pub fn pass(&self, defs: &[FeatDef], v: Option<f64>) -> bool {
        match v {
            None => false,
            Some(x) if defs[self.feat].cat => self.set.iter().any(|s| (s - x).abs() < 1e-9),
            Some(x) => x >= self.lo && x <= self.hi,
        }
    }
}

/// 割り出した条件。
#[derive(Debug, Clone, Default)]
pub struct Learned {
    pub rules: Vec<Rule>,
    /// 見本の数（数の欄が揃っている物）
    pub n: usize,
    /// 学べなかった理由（見本が足りない・共通する特徴が無い）
    pub why: Option<String>,
}

/// 並びの分位（並べ替え済みでなくてよい）。
fn pct(xs: &[f64], q: f64) -> f64 {
    let mut v = xs.to_vec();
    v.sort_by(|a, b| a.total_cmp(b));
    let i = ((v.len() - 1) as f64 * q).round() as usize;
    v[i]
}

/// 見本の数の下限（依頼: 3 枚以上で条件を割り出す）
pub const MIN_EXAMPLES: usize = 3;
const MAX_RULES: usize = 4;

/// 条件を割り出す。pop: ロット全体の特徴・ex: 見本・others: ほかのグループの見本（当てはまらないほどよい）。
pub fn learn(defs: &[FeatDef], pop: &[Vec<Option<f64>>], ex: &[Vec<Option<f64>>], others: &[Vec<Option<f64>>]) -> Learned {
    if ex.len() < MIN_EXAMPLES {
        return Learned {
            n: ex.len(),
            why: Some(format!("見本をあと {} 枚（{MIN_EXAMPLES} 枚で条件を割り出します）", MIN_EXAMPLES - ex.len())),
            ..Default::default()
        };
    }
    // 候補: 見本がまとまっている特徴
    let mut cands: Vec<Rule> = vec![];
    for (j, d) in defs.iter().enumerate() {
        let exv: Vec<f64> = ex.iter().filter_map(|r| r[j]).collect();
        let popv: Vec<f64> = pop.iter().filter_map(|r| r[j]).collect();
        if exv.len() < ex.len() || popv.len() < 3 {
            continue; // 見本のどれかに値が無い特徴は使わない（欠陥が見つからない画像など）
        }
        let rule = if d.cat {
            let mut set = exv.clone();
            set.sort_by(|a, b| a.total_cmp(b));
            set.dedup();
            if set.len() > 3 {
                continue;
            }
            Rule { feat: j, lo: 0.0, hi: 0.0, set, cover: 0.0, gap: 1.0 }
        } else {
            let spread = pct(&popv, 0.9) - pct(&popv, 0.1);
            if spread <= 0.0 {
                continue;
            }
            // 範囲: 見本の平均 ± 3 × 見本のばらつき（見本 3 枚の最小〜最大は、仲間全体の広がりよりずっと狭いのがふつう。
            // ばらつきはロット全体の広がりの 5% を下限にする）。見本の最小〜最大は必ず含む
            let n = exv.len() as f64;
            let mean = exv.iter().sum::<f64>() / n;
            let sd = (exv.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0)).sqrt().max(0.05 * spread);
            let (lo, hi) = (exv.iter().copied().fold(f64::INFINITY, f64::min), exv.iter().copied().fold(f64::NEG_INFINITY, f64::max));
            Rule { feat: j, lo: (mean - 3.0 * sd).min(lo), hi: (mean + 3.0 * sd).max(hi), set: vec![], cover: 0.0, gap: 0.0 }
        };
        let inside = popv.iter().filter(|&&x| rule.pass(defs, Some(x))).count();
        let cover = inside as f64 / popv.len() as f64;
        let gap = if d.cat {
            1.0
        } else {
            let spread = (pct(&popv, 0.9) - pct(&popv, 0.1)).max(1e-9);
            let near = popv
                .iter()
                .filter(|&&x| !rule.pass(defs, Some(x)))
                .map(|&x| if x < rule.lo { rule.lo - x } else { x - rule.hi })
                .fold(f64::INFINITY, f64::min);
            (if near.is_finite() { near } else { spread }) / spread
        };
        if cover < 0.5 {
            cands.push(Rule { cover, gap, ..rule });
        }
    }
    // 足すたびに当てはまる画像がいちばん減る候補を順に選ぶ（ほかのグループの見本が当てはまると 1 枚 5 枚ぶんの重さ）
    let mut alive: Vec<usize> = (0..pop.len()).collect();
    let mut alive_o: Vec<usize> = (0..others.len()).collect();
    let mut rules: Vec<Rule> = vec![];
    let others_inside = |r: &Rule, o: &[usize]| o.iter().filter(|&&i| r.pass(defs, others[i][r.feat])).count();
    while rules.len() < MAX_RULES {
        let cost = |r: &Rule, a: &[usize], o: &[usize]| {
            a.iter().filter(|&&i| r.pass(defs, pop[i][r.feat])).count() as f64
                + 5.0 * o.iter().filter(|&&i| r.pass(defs, others[i][r.feat])).count() as f64
        };
        let now = alive.len() as f64 + 5.0 * alive_o.len() as f64;
        let best = cands
            .iter()
            .filter(|c| !rules.iter().any(|r| r.feat == c.feat))
            .filter(|c| rules.is_empty() || others_inside(c, &alive_o) < alive_o.len())
            .map(|c| (cost(c, &alive, &alive_o), c))
            // 余白（範囲のすぐ外に画像の無い空き）の大きい順。仲間を本当に分ける特徴には空きがあり、見本がたまたま揃った特徴には無い。
            // 余白が同じくらい（0.02 以内）なら、よく絞れる方
            .min_by(|a, b| {
                if (a.1.gap - b.1.gap).abs() > 0.02 {
                    b.1.gap.total_cmp(&a.1.gap)
                } else {
                    a.0.total_cmp(&b.0).then(a.1.cover.total_cmp(&b.1.cover))
                }
            });
        let Some((c, r)) = best else { break };
        // 2 つめからは、ほかのグループの見本がまだ当てはまっていて、それを除けるときだけ足す
        // （残りを減らすだけの条件は、見本がたまたま近い値だった特徴で仲間を落とすことが多い。評価関数 classbench で確かめた）
        if !rules.is_empty() && (alive_o.is_empty() || others_inside(r, &alive_o) == alive_o.len()) {
            break;
        }
        let _ = (c, now);
        let r = r.clone();
        alive.retain(|&i| r.pass(defs, pop[i][r.feat]));
        alive_o.retain(|&i| r.pass(defs, others[i][r.feat]));
        rules.push(r);
    }
    let why = rules.is_empty().then(|| "見本に共通する特徴が見つかりません（見本を足すか、似た画像を選び直してください）".to_string());
    Learned { rules, n: ex.len(), why }
}

/// 1 枚を当てる → (満たした条件の数, 見本の中心への遠さ)。
pub fn score(defs: &[FeatDef], l: &Learned, x: &[Option<f64>]) -> (usize, f64) {
    let mut hit = 0;
    let (mut d2, mut k) = (0f64, 0usize);
    for r in &l.rules {
        if r.pass(defs, x[r.feat]) {
            hit += 1;
        }
        if !defs[r.feat].cat {
            if let Some(v) = x[r.feat] {
                let (c, half) = ((r.lo + r.hi) / 2.0, ((r.hi - r.lo) / 2.0).max(1e-9));
                d2 += ((v - c) / half).powi(2);
                k += 1;
            }
        }
    }
    (hit, if k > 0 { (d2 / k as f64).sqrt() } else { 0.0 })
}

/// 条件を人に読める形に（JSON）。fmt_cat: 分類の欄の値 → 名前（分類名・面の名前など）。
pub fn rule_json(defs: &[FeatDef], r: &Rule, fmt_cat: &dyn Fn(&str, f64) -> String) -> Value {
    let d = &defs[r.feat];
    let text = if d.cat {
        format!("{} = {}", d.label, r.set.iter().map(|v| fmt_cat(&d.key, *v)).collect::<Vec<_>>().join("・"))
    } else {
        format!("{} {}〜{}", d.label, nice(r.lo), nice(r.hi))
    };
    json!({"key": d.key, "label": d.label, "cat": d.cat, "lo": r.lo, "hi": r.hi, "set": r.set, "cover": (r.cover * 1000.0).round() / 1000.0, "text": text})
}

/// 数を見やすい桁に（有効 3 桁）。
pub fn nice(v: f64) -> String {
    if v == 0.0 || !v.is_finite() {
        return "0".into();
    }
    let digits = (2 - v.abs().log10().floor() as i32).clamp(0, 4) as usize;
    let s = format!("{v:.digits$}");
    if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    } else {
        s
    }
}

/// 計測の物差し（mm/px。横＝幅方向・縦＝長さ方向）の推定。
/// pairs: (欠陥データの幅 mm, 長さ mm, 画像の上の欠陥の幅 px, 長さ px)。
/// 1 件ごとの比の中央値と、ばらつき（四分位の幅 ÷ 中央値）。3 件未満・欠陥が 3 px 未満の物は使わない。
pub fn estimate_scale(pairs: &[(f64, f64, f64, f64)]) -> Option<Value> {
    let ok: Vec<&(f64, f64, f64, f64)> = pairs.iter().filter(|p| p.0 > 0.0 && p.1 > 0.0 && p.2 >= 3.0 && p.3 >= 3.0).collect();
    if ok.len() < 3 {
        return None;
    }
    let xs: Vec<f64> = ok.iter().map(|p| p.0 / p.2).collect();
    let ys: Vec<f64> = ok.iter().map(|p| p.1 / p.3).collect();
    let (mx, my) = (pct(&xs, 0.5), pct(&ys, 0.5));
    let spread = |v: &[f64], m: f64| (pct(v, 0.75) - pct(v, 0.25)) / m;
    Some(json!({"x": mx, "y": my, "n": ok.len(), "spread_x": spread(&xs, mx), "spread_y": spread(&ys, my), "from": "estimate"}))
}

/// 評価関数の部品（試験と、測る道具 examples/classbench.rs が使う）: 種類の違う欠陥の試しの画像と、見本 3 枚での仕分けの当たり具合。
pub mod bench {
    use super::*;

    /// 試しの画像（濃淡）。f(x, y) → 明るさ
    pub fn raster(w: usize, h: usize, f: impl Fn(usize, usize) -> u8) -> Raster {
        Raster { w, h, ch: 1, px: (0..w * h).map(|i| f(i % w, i / w)).collect() }
    }

    /// 決まった乱数（試験を毎回同じにする）
    pub struct Lcg(pub u64);
    impl Lcg {
        pub fn unit(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }
        pub fn range(&mut self, a: f64, b: f64) -> f64 {
            a + (b - a) * self.unit()
        }
    }

    /// 種類の違う欠陥の画像（0 黒点・1 スジ〈縦に細長い〉・2 白点・3 薄く大きなシミ）
    pub fn defect(kind: usize, rnd: &mut Lcg) -> Raster {
        let (w, h) = (64, 64);
        let (cx, cy) = (rnd.range(20.0, 44.0), rnd.range(20.0, 44.0));
        let noise: Vec<f64> = (0..w * h).map(|_| rnd.range(-12.0, 12.0)).collect();
        let (r, len) = (rnd.range(3.0, 5.0), rnd.range(18.0, 26.0));
        let big = rnd.range(11.0, 15.0);
        raster(w, h, move |x, y| {
            let (dx, dy) = (x as f64 - cx, y as f64 - cy);
            let base = 160.0 + noise[y * w + x];
            let v = match kind {
                0 if dx * dx + dy * dy < r * r => 50.0,
                1 if dx.abs() < 1.2 && dy.abs() < len => 70.0,
                2 if dx * dx + dy * dy < r * r => 245.0,
                3 if dx * dx + dy * dy < big * big => 115.0 + noise[y * w + x] * 0.3,
                _ => base,
            };
            v.clamp(0.0, 255.0) as u8
        })
    }

    /// 種類ごとの (適合率, 再現率)
    pub fn evaluate(per: usize, seed: u64) -> (Vec<(f64, f64)>, Vec<Learned>, Vec<FeatDef>) {
        let mut rnd = Lcg(seed);
        let defs: Vec<FeatDef> =
            IMG_FEATS.iter().map(|(k, l)| FeatDef { key: k.to_string(), label: l.to_string(), cat: *k == "img:polarity" }).collect();
        let mut pop = vec![];
        let mut truth = vec![];
        for i in 0..per * 4 {
            pop.push(image_features(&defect(i % 4, &mut rnd)).vals);
            truth.push(i % 4);
        }
        let ex: Vec<Vec<usize>> = (0..4).map(|k| (0..pop.len()).filter(|&i| truth[i] == k).take(3).collect()).collect();
        let learned: Vec<Learned> = (0..4)
            .map(|k| {
                let mine: Vec<_> = ex[k].iter().map(|&i| pop[i].clone()).collect();
                let others: Vec<_> = (0..4).filter(|&o| o != k).flat_map(|o| ex[o].iter().map(|&i| pop[i].clone())).collect();
                learn(&defs, &pop, &mine, &others)
            })
            .collect();
        let used: std::collections::HashSet<usize> = ex.iter().flatten().copied().collect();
        let mut tp = [0f64; 4];
        let (mut fp, mut fn_) = ([0f64; 4], [0f64; 4]);
        for i in (0..pop.len()).filter(|i| !used.contains(i)) {
            // いちばん当てはまるグループ（すべての条件を満たす物の中で、見本の中心に近い物）
            let best = (0..4)
                .map(|k| (k, score(&defs, &learned[k], &pop[i])))
                .filter(|(k, (hit, _))| *hit == learned[*k].rules.len() && *hit > 0)
                .min_by(|a, b| a.1 .1.total_cmp(&b.1 .1))
                .map(|(k, _)| k);
            match best {
                Some(k) if k == truth[i] => tp[k] += 1.0,
                Some(k) => {
                    fp[k] += 1.0;
                    fn_[truth[i]] += 1.0;
                }
                None => fn_[truth[i]] += 1.0,
            }
        }
        ((0..4).map(|k| (tp[k] / (tp[k] + fp[k]).max(1.0), tp[k] / (tp[k] + fn_[k]).max(1.0))).collect(), learned, defs)
    }
}

#[cfg(test)]
pub mod tests {
    use super::bench::*;
    use super::*;

    #[test]
    fn finds_the_defect_and_its_shape() {
        let dot = image_features(&raster(40, 30, |x, y| {
            if (14..20).contains(&x) && (10..14).contains(&y) {
                30
            } else {
                170 + ((x * 7 + y * 3) % 9) as u8
            }
        }));
        let b = dot.blob.expect("欠陥が見つかる");
        assert_eq!((b.w(), b.h(), b.area, b.polarity), (6, 4, 24, -1.0));
        let line = image_features(&raster(40, 40, |x, y| if x == 20 && (5..35).contains(&y) { 30 } else { 170 }));
        let b = line.blob.unwrap();
        assert!(b.elong > 5.0 && b.angle > 80.0, "縦の細い線は細長く、向きは縦: {b:?}");
        let flat = image_features(&raster(30, 30, |x, y| 120 + ((x + y) % 5) as u8));
        assert!(flat.blob.is_none() && flat.vals[2].is_none(), "欠陥の無い画像");
    }

    #[test]
    fn data_fields_are_chosen_and_typed() {
        let v = |xs: &[f64]| xs.iter().map(|x| Some(*x)).collect::<Vec<_>>();
        assert_eq!(data_feature_kind(&v(&[1.0, 2.0, 3.0, 4.0, 5.0])), None, "1 件ごとに違う整数は番号");
        assert_eq!(data_feature_kind(&v(&[2.0, 2.0, 2.0])), None, "どの件も同じ");
        assert_eq!(data_feature_kind(&v(&[1.0, 2.0, 1.0, 3.0, 1.0])), Some(true), "種類の少ない整数は分類");
        assert_eq!(data_feature_kind(&v(&[1.5, 2.25, 1.5, 3.0])), Some(false), "小数は数");
    }

    /// 評価関数: 4 種類 × 40 枚の画像から、種類ごとに見本 3 枚で条件を割り出し、残り 148 枚を当てる。正しく当てた割合（再現率）と、
    /// 当てた物のうち正しい割合（適合率）が、どの種類も 0.9 以上
    #[test]
    fn three_examples_sort_four_kinds_of_defects() {
        let (r, _, _) = evaluate(40, 7);
        for (k, (p, rc)) in r.iter().enumerate() {
            assert!(*p >= 0.9 && *rc >= 0.9, "種類 {k}: 適合率 {p:.2}・再現率 {rc:.2}（全体 {r:?}）");
        }
    }

    #[test]
    fn too_few_examples_say_how_many_more() {
        let defs = vec![FeatDef { key: "a".into(), label: "A".into(), cat: false }];
        let l = learn(&defs, &vec![vec![Some(1.0)]; 5], &[vec![Some(1.0)], vec![Some(1.0)]], &[]);
        assert!(l.rules.is_empty() && l.why.unwrap().contains("あと 1 枚"));
    }

    #[test]
    fn scale_is_the_median_ratio_per_axis() {
        let s = estimate_scale(&[(1.2, 2.5, 12.0, 10.0), (2.4, 5.0, 24.0, 20.0), (1.0, 2.0, 10.0, 8.0), (9.0, 9.0, 1.0, 1.0)]).unwrap();
        let near = |a: f64, b: f64| (a - b).abs() < 1e-12;
        assert!(
            near(s["x"].as_f64().unwrap(), 0.1) && near(s["y"].as_f64().unwrap(), 0.25) && s["n"] == 3,
            "3 px 未満の欠陥は使わない: {s}"
        );
        assert!(estimate_scale(&[(1.0, 1.0, 5.0, 5.0)]).is_none(), "3 件未満は推定しない");
        assert_eq!(nice(2.2345), "2.23");
        assert_eq!(nice(0.081234), "0.0812");
        assert_eq!(nice(1234.6), "1235");
    }
}
