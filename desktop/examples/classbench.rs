//! 仕分けの当たり具合を測る（評価関数。仕分けの作りを変える前と後で同じ物差しで比べる）。
//!
//!     cargo run --release --example classbench [1 種類の枚数=40] [種の数=5]
//!
//! 種類の違う 4 つの欠陥（黒点・縦のスジ・白点・薄く大きなシミ）の試しの画像を作り、種類ごとに見本 3 枚で条件を割り出して、
//! 残りを当てる。種ごとに、種類ごとの適合率（当てた物のうち正しい割合）・再現率（仲間のうち当てた割合）と、割り出した条件を出す。
use dt_core::classify::{bench::evaluate, nice};

fn main() {
    let a: Vec<usize> = std::env::args().skip(1).filter_map(|s| s.parse().ok()).collect();
    let (per, seeds) = (a.first().copied().unwrap_or(40), a.get(1).copied().unwrap_or(5));
    let names = ["黒点", "縦のスジ", "白点", "薄く大きなシミ"];
    let mut worst = [(1f64, 1f64); 4];
    for seed in 1..=seeds as u64 {
        let (r, learned, defs) = evaluate(per, seed);
        println!("== 種 {seed}（1 種類 {per} 枚・見本 3 枚）");
        for (k, (p, rc)) in r.iter().enumerate() {
            let rules: Vec<String> = learned[k]
                .rules
                .iter()
                .map(|x| {
                    if defs[x.feat].cat {
                        format!("{} = {:?}", defs[x.feat].label, x.set)
                    } else {
                        format!("{} {}〜{}", defs[x.feat].label, nice(x.lo), nice(x.hi))
                    }
                })
                .collect();
            println!("  {:<8} 適合率 {p:.2}・再現率 {rc:.2}  条件: {}", names[k], rules.join(" かつ "));
            worst[k] = (worst[k].0.min(*p), worst[k].1.min(*rc));
        }
    }
    println!("== いちばん悪かった値（{seeds} 種）");
    for (k, (p, rc)) in worst.iter().enumerate() {
        println!("  {:<8} 適合率 {p:.2}・再現率 {rc:.2}", names[k]);
    }
}
