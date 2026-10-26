//! 裏の仕事の列（優先度つき）。画像の展開・縮小画像づくりを、PC の芯の数だけ並べて回す。
//! - 優先度の高い物から（同じ優先度なら入れた順）。画面で見ている所・いま開いたロットを先にする
//! - 仕事は取り出したときに「まだ要るか」を見る（別のロットへ移ったら、前のロットの残りはしない）

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::sync::{Arc, Condvar, Mutex};

type Job = Box<dyn FnOnce() + Send + 'static>;

struct Item {
    pri: i64,
    seq: u64,
    job: Job,
}

impl PartialEq for Item {
    fn eq(&self, o: &Self) -> bool {
        self.pri == o.pri && self.seq == o.seq
    }
}
impl Eq for Item {}
impl PartialOrd for Item {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Item {
    fn cmp(&self, o: &Self) -> Ordering {
        self.pri.cmp(&o.pri).then(o.seq.cmp(&self.seq))
    }
}

#[derive(Default)]
struct State {
    heap: BinaryHeap<Item>,
    seq: u64,
    busy: usize,
    stop: bool,
}

pub struct Pool {
    st: Arc<(Mutex<State>, Condvar)>,
    threads: usize,
}

impl Pool {
    pub fn new(threads: usize, name: &str) -> Pool {
        let st: Arc<(Mutex<State>, Condvar)> = Arc::default();
        for i in 0..threads.max(1) {
            let st = st.clone();
            let _ = std::thread::Builder::new().name(format!("{name}-{i}")).spawn(move || loop {
                let job = {
                    let (m, cv) = &*st;
                    let mut g = m.lock().unwrap();
                    loop {
                        if g.stop {
                            return;
                        }
                        if let Some(it) = g.heap.pop() {
                            g.busy += 1;
                            break it.job;
                        }
                        g = cv.wait(g).unwrap();
                    }
                };
                // 1 つの仕事の失敗（panic）で糸を失わない
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
                let (m, cv) = &*st;
                m.lock().unwrap().busy -= 1;
                cv.notify_all();
            });
        }
        Pool { st, threads: threads.max(1) }
    }

    pub fn threads(&self) -> usize {
        self.threads
    }

    pub fn submit(&self, pri: i64, job: impl FnOnce() + Send + 'static) {
        let (m, cv) = &*self.st;
        let mut g = m.lock().unwrap();
        g.seq += 1;
        let seq = g.seq;
        g.heap.push(Item { pri, seq, job: Box::new(job) });
        cv.notify_one();
    }

    /// 列が空になり、動いている仕事も終わるまで待つ（試験・測る道具）。
    pub fn wait_idle(&self) {
        let (m, cv) = &*self.st;
        let mut g = m.lock().unwrap();
        while !g.heap.is_empty() || g.busy > 0 {
            g = cv.wait(g).unwrap();
        }
    }

    pub fn pending(&self) -> usize {
        self.st.0.lock().unwrap().heap.len()
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        let (m, cv) = &*self.st;
        m.lock().unwrap().stop = true;
        cv.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn higher_priority_first_then_in_order() {
        let p = Pool::new(1, "t");
        let seen = Arc::new(Mutex::new(vec![]));
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        // 1 つめの仕事で糸を止めておき、その間に並べる
        let g = gate.clone();
        p.submit(0, move || {
            let (m, cv) = &*g;
            let mut o = m.lock().unwrap();
            while !*o {
                o = cv.wait(o).unwrap();
            }
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        for (pri, name) in [(1, "a"), (5, "b"), (1, "c"), (9, "d")] {
            let s = seen.clone();
            p.submit(pri, move || s.lock().unwrap().push(name));
        }
        p.submit(3, || panic!("失敗しても糸は残る"));
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        p.wait_idle();
        assert_eq!(*seen.lock().unwrap(), ["d", "b", "a", "c"]);
    }
}
