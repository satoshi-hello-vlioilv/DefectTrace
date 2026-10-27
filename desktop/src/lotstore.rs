//! ロット表の値の覚え（作業場所の lotvalues.json）。
//!
//! 検査のデータは基本的に変わらないので、1 度読んだロットの値は残し、範囲を変えても・画面を開き直しても・アプリを起こし直しても
//! 読み直さない（共有フォルダ〈Box・ネットワーク〉では、ロットを読むたびに数十〜数百 KB と行き来の待ちがかかる）。
//! 読み直すのは、画面の「読み直す」を押したときと、ロットの INSP_INFO・DETECT_INFO の大きさ・更新時刻が変わったとき
//! （検査の途中で書き込みが続いているロット）。値はロット × 列（ファイル・鍵・単位の倍率・日時の形）ごとに覚える。
//! 書き出しは裏で 3 秒ごとにまとめて行う（読む手を止めない）。

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Entry {
    sig: String,
    vals: HashMap<String, String>,
}

pub struct LotStore {
    path: PathBuf,
    /// 値の作り方の印（アプリの版・設定）。変わったら、覚えを全部捨てる（時差・多量の名前などで値が変わるため）
    salt: String,
    m: Mutex<HashMap<String, Entry>>,
    dirty: AtomicBool,
}

/// 列の鍵（{file, key, scale?, fmt?} を 1 つの文字に）。
pub fn col_key(c: &Value) -> String {
    let s = |k: &str| match &c[k] {
        Value::Null => String::new(),
        Value::String(x) => x.clone(),
        v => v.to_string(),
    };
    format!("{}|{}|{}|{}", s("file"), s("key"), s("scale"), s("fmt"))
}

/// ロットの印（INSP_INFO・DETECT_INFO の大きさ・更新時刻。中身は読まない）。変わったら、そのロットの覚えを捨てる
/// （検査の途中のロットは、DETECT_INFO が増え、終わると INSP_INFO が書き直される）。
pub fn lot_sig(lot: &Path) -> String {
    let stat = |names: &[&str]| {
        names
            .iter()
            .find_map(|n| std::fs::metadata(lot.join(n)).ok())
            .map(|m| {
                let t = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
                format!("{}-{t}", m.len())
            })
            .unwrap_or_else(|| "-".into())
    };
    format!("{}|{}", stat(&["INSP_INFO.DAT", "INSP_INFO.dat"]), stat(&["DETECT_INFO.dat", "DETECT_INFO.DAT"]))
}

impl LotStore {
    /// 作業場所の lotvalues.json を読み、裏の書き出しを始める。salt は値の作り方の印（アプリの版・設定）。
    pub fn open(home: &Path, salt: &str) -> Arc<LotStore> {
        let path = home.join("lotvalues.json");
        let mut m = HashMap::new();
        let saved = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).filter(|v| v["salt"] == salt);
        if let Some(Value::Object(o)) = saved.map(|v| v["lots"].clone()) {
            for (lot, e) in o {
                let vals = e["vals"]
                    .as_object()
                    .map(|v| v.iter().map(|(k, x)| (k.clone(), x.as_str().unwrap_or("").to_string())).collect())
                    .unwrap_or_default();
                m.insert(lot, Entry { sig: e["sig"].as_str().unwrap_or("").to_string(), vals });
            }
        }
        let me = Arc::new(LotStore { path, salt: salt.to_string(), m: Mutex::new(m), dirty: AtomicBool::new(false) });
        let w = Arc::downgrade(&me);
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let Some(s) = w.upgrade() else { break };
            if s.dirty.swap(false, Ordering::SeqCst) {
                s.save();
            }
        });
        me
    }

    /// 覚えている値（印が同じときだけ）。cols の順に、無い所は None。
    pub fn get(&self, lot: &str, sig: &str, cols: &[String]) -> Vec<Option<String>> {
        let m = self.m.lock().unwrap();
        match m.get(lot).filter(|e| e.sig == sig) {
            Some(e) => cols.iter().map(|k| e.vals.get(k).cloned()).collect(),
            None => vec![None; cols.len()],
        }
    }

    /// 値を覚える（印が変わっていれば、前の値は捨てる）。
    pub fn put(&self, lot: &str, sig: &str, vals: impl IntoIterator<Item = (String, String)>) {
        let mut m = self.m.lock().unwrap();
        let e = m.entry(lot.to_string()).or_default();
        if e.sig != sig {
            *e = Entry { sig: sig.to_string(), vals: HashMap::new() };
        }
        e.vals.extend(vals);
        self.dirty.store(true, Ordering::SeqCst);
    }

    /// 覚えを捨てる（「読み直す」）。
    pub fn forget(&self, lots: &[String]) {
        let mut m = self.m.lock().unwrap();
        for l in lots {
            m.remove(l);
        }
        self.dirty.store(true, Ordering::SeqCst);
    }

    /// 覚えているロットの数（確かめ用）。
    pub fn len(&self) -> usize {
        self.m.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// 書き出す（一時ファイルに書いてから置き換える。途中で止まっても前のファイルが残る）。
    pub fn save(&self) {
        let body = {
            let m = self.m.lock().unwrap();
            let lots: Map<String, Value> = m.iter().map(|(k, e)| (k.clone(), json!({"sig": e.sig, "vals": e.vals}))).collect();
            serde_json::to_vec(&json!({"version": 1, "salt": self.salt, "lots": lots})).unwrap_or_default()
        };
        let tmp = self.path.with_extension("json.tmp");
        let write = || -> std::io::Result<()> {
            use std::io::Write;
            std::fs::create_dir_all(self.path.parent().unwrap_or(Path::new(".")))?;
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(&body)?;
            f.sync_all()?; // ディスクに書けてから置き換える（電源が落ちても、前のファイルか新しいファイルのどちらかが残る）
            std::fs::rename(&tmp, &self.path)
        };
        if let Err(e) = write() {
            eprintln!("[WARN] lotvalues.json: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_values_across_reopen_and_drops_on_signature_change() {
        let home = std::env::temp_dir().join(format!("dt-lotstore-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let cols = vec!["a|x||".to_string(), "b|y|0.001|".to_string()];
        let s = LotStore::open(&home, "v1");
        assert!(s.is_empty());
        s.put("/lot1", "10-1", [(cols[0].clone(), "1".to_string())]);
        assert_eq!(s.get("/lot1", "10-1", &cols), vec![Some("1".into()), None], "読んだ列だけ覚える");
        s.save();
        assert!(LotStore::open(&home, "v2").is_empty(), "版・設定が変われば覚えを使わない");
        let s2 = LotStore::open(&home, "v1");
        assert_eq!(s2.get("/lot1", "10-1", &cols)[0], Some("1".into()), "起こし直しても残る");
        assert_eq!(s2.get("/lot1", "11-2", &cols)[0], None, "印（INSP_INFO・DETECT_INFO の大きさ・時刻）が変われば使わない");
        s2.put("/lot1", "11-2", [(cols[1].clone(), "2".to_string())]);
        assert_eq!(s2.get("/lot1", "11-2", &cols), vec![None, Some("2".into())], "印が変わったら前の値は捨てる");
        s2.forget(&["/lot1".to_string()]);
        assert_eq!(s2.get("/lot1", "11-2", &cols), vec![None, None], "読み直す");
        let _ = std::fs::remove_dir_all(&home);
        assert_eq!(col_key(&json!({"file": "dat:I", "key": "k", "scale": 0.001})), "dat:I|k|0.001|");
    }
}
