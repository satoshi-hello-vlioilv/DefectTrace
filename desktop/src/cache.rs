//! 大きさに上限のある覚え（使った順）。合計の重さ（だいたいのバイト数）が予算を超えたら、いちばん前に使った物から捨てる。
//!
//! ロット（読んだ .dat）・XML の (鍵, 値)・画像と欠陥の対応・木の札の値を覚えるのに使う。数千ロットを続けて読んでも
//! メモリが増え続けない（前は件数だけで区切り、ロット表で数千ロットを読むと 1 ロット数 MB × 数百で GB を超えた）。

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Mutex;

struct Entry<V> {
    v: V,
    w: usize,
    at: u64,
}

struct Inner<K, V> {
    map: HashMap<K, Entry<V>>,
    tick: u64,
    total: usize,
}

pub struct Lru<K, V> {
    inner: Mutex<Inner<K, V>>,
    budget: usize,
    /// 中身が後から増える物の重さ（捨てる前に量り直す）。無ければ入れたときの重さのまま
    weigh: Option<fn(&V) -> usize>,
}

impl<K: Eq + Hash + Clone, V: Clone> Lru<K, V> {
    /// budget: 重さの合計の上限（バイト）。1 つが予算より重くても、いちばん新しい 1 つは残す。
    pub fn new(budget: usize) -> Self {
        Lru { inner: Mutex::new(Inner { map: HashMap::new(), tick: 0, total: 0 }), budget, weigh: None }
    }

    /// 重さを量る関数つき（ロット: 覚えた後で .dat を読むと重くなる。捨てるかを決める前に、全部を量り直す）。
    pub fn weighed(budget: usize, weigh: fn(&V) -> usize) -> Self {
        Lru { weigh: Some(weigh), ..Self::new(budget) }
    }

    pub fn get(&self, k: &K) -> Option<V> {
        let mut g = self.inner.lock().unwrap();
        g.tick += 1;
        let t = g.tick;
        g.map.get_mut(k).map(|e| {
            e.at = t;
            e.v.clone()
        })
    }

    /// 入れる（同じ鍵がもうあれば、そちらを返す）。w は重さ。
    pub fn insert(&self, k: K, v: V, w: usize) -> V {
        let mut g = self.inner.lock().unwrap();
        g.tick += 1;
        let t = g.tick;
        if let Some(e) = g.map.get_mut(&k) {
            e.at = t;
            return e.v.clone();
        }
        g.map.insert(k, Entry { v: v.clone(), w, at: t });
        g.total += w;
        Self::evict(&mut g, self.budget, self.weigh);
        v
    }

    /// 入れる（同じ鍵があれば置き換える）。読み込みの途中で作り直す物（画像と欠陥の対応）に使う。
    pub fn put(&self, k: K, v: V, w: usize) {
        let mut g = self.inner.lock().unwrap();
        g.tick += 1;
        let t = g.tick;
        if let Some(old) = g.map.insert(k, Entry { v, w, at: t }) {
            g.total -= old.w;
        }
        g.total += w;
        Self::evict(&mut g, self.budget, self.weigh);
    }

    /// 重さを付け直す（後から中身が増える物: ロットは .dat を読むたびに重くなる）。
    pub fn reweigh(&self, k: &K, w: usize) {
        let mut g = self.inner.lock().unwrap();
        let old = match g.map.get_mut(k) {
            Some(e) => std::mem::replace(&mut e.w, w),
            None => return,
        };
        g.total = g.total - old + w;
        Self::evict(&mut g, self.budget, self.weigh);
    }

    fn evict(g: &mut Inner<K, V>, budget: usize, weigh: Option<fn(&V) -> usize>) {
        if let Some(f) = weigh {
            g.total = 0;
            for e in g.map.values_mut() {
                e.w = f(&e.v);
            }
            g.total = g.map.values().map(|e| e.w).sum();
        }
        while g.total > budget && g.map.len() > 1 {
            let Some(k) = g.map.iter().min_by_key(|(_, e)| e.at).map(|(k, _)| k.clone()) else { break };
            if let Some(e) = g.map.remove(&k) {
                g.total -= e.w;
            }
        }
    }

    pub fn clear(&self) {
        let mut g = self.inner.lock().unwrap();
        g.map.clear();
        g.total = 0;
    }

    /// 覚えている数と重さの合計（確かめ用）。
    pub fn stats(&self) -> (usize, usize) {
        let g = self.inner.lock().unwrap();
        (g.map.len(), g.total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evicts_least_recently_used_by_weight() {
        let c: Lru<&str, i32> = Lru::new(10);
        c.insert("a", 1, 4);
        c.insert("b", 2, 4);
        assert_eq!(c.get(&"a"), Some(1)); // a を使ったので、次に捨てるのは b
        c.insert("c", 3, 4);
        assert_eq!(c.get(&"b"), None);
        assert_eq!((c.get(&"a"), c.get(&"c")), (Some(1), Some(3)));
        assert_eq!(c.stats(), (2, 8));
        c.reweigh(&"c", 20); // 重くなった物も、いちばん新しい 1 つは残す
        assert_eq!(c.stats(), (1, 20));
        assert_eq!(c.insert("d", 4, 1), 4);
        assert_eq!(c.get(&"c"), None, "前に使った重い物から捨てる");
        c.put("d", 5, 2);
        assert_eq!((c.get(&"d"), c.stats()), (Some(5), (1, 2)), "put は置き換える");
    }

    #[test]
    fn reweighs_growing_values_before_evicting() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        // 値は「後から増える重さ」を持つ（ロットが .dat を読むと重くなるのと同じ）
        let c: Lru<u8, std::sync::Arc<AtomicUsize>> = Lru::weighed(10, |v| v.load(Ordering::SeqCst));
        let a = c.insert(1, std::sync::Arc::new(AtomicUsize::new(1)), 1);
        c.insert(2, std::sync::Arc::new(AtomicUsize::new(1)), 1);
        a.store(9, Ordering::SeqCst); // 覚えた後で重くなった
        c.insert(3, std::sync::Arc::new(AtomicUsize::new(1)), 1);
        assert_eq!(c.get(&1).map(|v| v.load(Ordering::SeqCst)), None, "量り直すと予算を超えるので、前に使った 1 を捨てる");
        assert_eq!(c.stats(), (2, 2));
    }
}
