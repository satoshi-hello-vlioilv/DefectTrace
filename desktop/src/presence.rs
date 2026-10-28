//! 使用状況（だれが・どの PC で・どの版を・いつ使ったか）。LotScope の presence と同じ決まり（program/docs/APP-MANAGEMENT.md）。
//!
//! 置き場は共有の置き場（<配布の置き場のアプリのフォルダ>\shared）の presence。書くのは自分の PC の分のファイルだけなので、
//! 何台が同時に書いてもぶつからない（一時ファイルに書いてから置き換える）:
//! - now/<鍵>.json: いま使っている印 {key, login, pc, version, developer, since, at, left}。at が TTL より古いか left なら使っていない
//! - history/<鍵>.json: 要約 {key, login, pc, firstAt, lastAt, sessions, totalSec, version, versions{版: 最後に使った時}, developer}
//! - sessions/<鍵>/<YYYY-MM>.json: 使い始めごとの記録 {key, login, pc, sessions: [{start, end, sec, version}]}
//! - settings.json: 記録を残す日数 {historyDays, by, at}
//! - nudge/<鍵>.json: 管理者からその PC への「更新のお願い」{key, version, by, at}（その PC が心拍の答えで受け取り、画面に帯を出す。
//!   その版になったら消える）。書くのは管理者だが、1 つの鍵に 1 つのファイルなので、ほかの PC の書き込みとはぶつからない
//!
//! 鍵は「PC 名@ログイン名」（ファイル名に使えない字は _。置き換えたときは元の字の指紋を足して重ならないように）。
//! 画面が 20 秒ごとに心拍（POST /api/heartbeat）を送り、閉じるときに left を送る。前の心拍から TTL より空いたら新しい使い始め。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 心拍がこれより古ければ「使っていない」（画面は 20 秒ごとに送る）
pub const TTL_SEC: i64 = 75;
/// 記録を残す日数（既定・下限・上限）
pub const HISTORY_DAYS: (i64, i64, i64) = (365, 30, 3650);
const FMT: &str = "%Y-%m-%dT%H:%M:%S";

type Now = chrono::NaiveDateTime;

pub fn now() -> Now {
    chrono::Local::now().naive_local()
}
fn ts(t: Now) -> String {
    t.format(FMT).to_string()
}
fn parse(s: &Value) -> Option<Now> {
    chrono::NaiveDateTime::parse_from_str(s.as_str()?, FMT).ok()
}

/// 鍵「PC 名@ログイン名」。ファイル名に使えない字は _ にし、置き換えたときは元の字の指紋（16 進 6 桁）を足す。100 字まで。
pub fn key(login: &str, pc: &str) -> String {
    let raw = format!("{}@{}", pc.trim(), login.trim());
    let clean: String = raw.chars().map(|c| if c.is_alphanumeric() || "@._-".contains(c) { c } else { '_' }).collect();
    let mut k = if clean == raw {
        clean
    } else {
        let h = raw.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3));
        format!("{clean}~{:06x}", h & 0xffffff)
    };
    k.truncate(k.char_indices().nth(100).map(|(i, _)| i).unwrap_or(k.len()));
    k
}

/// 画面から来た鍵をパスに使ってよいか（区切り・.. ・空を断る）。
pub fn safe_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 120 && !k.contains(['/', '\\', ':']) && k != "." && !k.contains("..")
}

fn read(p: &Path) -> Option<Value> {
    let b = std::fs::read(p).ok()?;
    serde_json::from_slice(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b)).ok()
}

fn write(p: &Path, v: &Value) -> Result<(), String> {
    let dir = p.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
    let tmp = dir.join(format!(".{}.{}.tmp", p.file_name().and_then(|n| n.to_str()).unwrap_or("x"), std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec_pretty(v).unwrap_or_default()).map_err(|e| format!("{} に書けません: {e}", tmp.display()))?;
    // Windows では読んでいる人がいると置き換えを断られることがある。少し待って 5 回まで
    for i in 0..5 {
        match std::fs::rename(&tmp, p) {
            Ok(()) => return Ok(()),
            Err(_) if i < 4 => std::thread::sleep(std::time::Duration::from_millis(200)),
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(format!("{} を置き換えられません: {e}", p.display()));
            }
        }
    }
    Ok(())
}

/// この PC の使い始め（同じ窓が開いている間は 1 回。心拍が TTL より空いたら新しい使い始め）。
#[derive(Default)]
pub struct Session {
    state: Mutex<Option<(String, Now, Now)>>, // 鍵・始め・前の心拍
}

/// だれが（心拍に書く物）
pub struct Me<'a> {
    pub login: &'a str,
    pub pc: &'a str,
    pub version: &'a str,
    pub developer: bool,
}

impl Session {
    /// 心拍を書く。left: 閉じる知らせ。→ この PC の鍵
    pub fn beat(&self, dir: &Path, me: &Me, t: Now, left: bool) -> Result<String, String> {
        let k = key(me.login, me.pc);
        let mut st = self.state.lock().unwrap();
        let fresh = match st.as_ref() {
            Some((sk, _, last)) => *sk != k || (t - *last).num_seconds() > TTL_SEC,
            None => true,
        };
        let start = if fresh { t } else { st.as_ref().unwrap().1 };
        let gained = if fresh { 0 } else { (t - st.as_ref().unwrap().2).num_seconds().max(0) };
        *st = if left { None } else { Some((k.clone(), start, t)) };
        drop(st);
        let base = json!({"key": k, "login": me.login, "pc": me.pc});
        write(
            &dir.join("now").join(format!("{k}.json")),
            &json!({"key": k, "login": me.login, "pc": me.pc, "version": me.version, "developer": me.developer,
                    "since": ts(start), "at": ts(t), "left": left}),
        )?;
        // 要約
        let hp = dir.join("history").join(format!("{k}.json"));
        let mut h = read(&hp).filter(Value::is_object).unwrap_or_else(|| {
            let mut v = base.clone();
            v["firstAt"] = json!(ts(t));
            v["sessions"] = json!(0);
            v["totalSec"] = json!(0);
            v["versions"] = json!({});
            v
        });
        if fresh {
            h["sessions"] = json!(h["sessions"].as_i64().unwrap_or(0) + 1);
        }
        h["totalSec"] = json!(h["totalSec"].as_i64().unwrap_or(0) + gained);
        h["lastAt"] = json!(ts(t));
        h["version"] = json!(me.version);
        h["developer"] = json!(me.developer);
        h["login"] = json!(me.login);
        h["pc"] = json!(me.pc);
        let mut vs: Vec<(String, String)> = h["versions"]
            .as_object()
            .map(|o| o.iter().map(|(a, b)| (a.clone(), b.as_str().unwrap_or("").to_string())).collect())
            .unwrap_or_default();
        vs.retain(|(v, _)| v != me.version);
        vs.push((me.version.to_string(), ts(t)));
        vs.sort_by(|a, b| b.1.cmp(&a.1));
        vs.truncate(10);
        h["versions"] = Value::Object(vs.into_iter().map(|(a, b)| (a, json!(b))).collect());
        write(&hp, &h)?;
        // 使い始めごとの記録（月のファイル）
        let sp = dir.join("sessions").join(&k).join(format!("{}.json", start.format("%Y-%m")));
        let mut m = read(&sp).filter(Value::is_object).unwrap_or_else(|| {
            let mut v = base.clone();
            v["sessions"] = json!([]);
            v
        });
        let list = m["sessions"].as_array_mut().unwrap();
        let row = json!({"start": ts(start), "end": ts(t), "sec": (t - start).num_seconds(), "version": me.version});
        match list.iter_mut().find(|s| s["start"] == json!(ts(start))) {
            Some(s) => *s = row,
            None => list.push(row),
        }
        write(&sp, &m)?;
        if fresh {
            prune_key(dir, &k, history_days(dir), t);
        }
        Ok(k)
    }
}

/// 管理者からその PC へ「更新のお願い」を置く（version: そろえてほしい版）。
pub fn nudge(dir: &Path, k: &str, version: &str, by: &str, t: Now) -> Result<Value, String> {
    if !safe_key(k) {
        return Err("鍵の形が違います".into());
    }
    if version.is_empty() {
        return Err("そろえてほしい版がありません（配る版を決めてから促してください）".into());
    }
    let v = json!({"key": k, "version": version, "by": by, "at": ts(t)});
    write(&dir.join("nudge").join(format!("{k}.json")), &v)?;
    Ok(v)
}

/// この PC へのお願い（あれば）。この PC がもうその版なら消して None。
pub fn my_nudge(dir: &Path, k: &str, my_version: &str) -> Option<Value> {
    let p = dir.join("nudge").join(format!("{k}.json"));
    let v = read(&p)?;
    if v["version"].as_str() == Some(my_version) {
        let _ = std::fs::remove_file(&p);
        return None;
    }
    Some(v)
}

/// 記録を残す日数（settings.json。無ければ既定）。
pub fn history_days(dir: &Path) -> i64 {
    read(&dir.join("settings.json")).and_then(|v| v["historyDays"].as_i64()).unwrap_or(HISTORY_DAYS.0).clamp(HISTORY_DAYS.1, HISTORY_DAYS.2)
}

pub fn set_history_days(dir: &Path, days: i64, by: &str) -> Result<i64, String> {
    if !(HISTORY_DAYS.1..=HISTORY_DAYS.2).contains(&days) {
        return Err(format!("記録を残す日数は {}〜{} 日です", HISTORY_DAYS.1, HISTORY_DAYS.2));
    }
    write(&dir.join("settings.json"), &json!({"historyDays": days, "by": by, "at": ts(now())}))?;
    Ok(days)
}

/// その鍵の、残す日数より古い使い始めを消す（月のファイルごと・境目の月は古い行だけ）。→ 消した数
fn prune_key(dir: &Path, k: &str, days: i64, t: Now) -> usize {
    let limit = t - chrono::Duration::days(days);
    let mut n = 0;
    let Ok(rd) = std::fs::read_dir(dir.join("sessions").join(k)) else { return 0 };
    for e in rd.flatten() {
        let p = e.path();
        let Some(mut m) = read(&p) else { continue };
        let Some(list) = m["sessions"].as_array_mut() else { continue };
        let before = list.len();
        list.retain(|s| parse(&s["end"]).is_some_and(|e| e >= limit));
        n += before - list.len();
        if list.is_empty() {
            let _ = std::fs::remove_file(&p);
        } else if list.len() != before {
            let _ = write(&p, &m);
        }
    }
    n
}

/// 全 PC の古い記録を消す（管理者の「古い記録を今すぐ整理」）。→ 消した使い始めの数
pub fn prune_all(dir: &Path, t: Now) -> usize {
    let days = history_days(dir);
    let Ok(rd) = std::fs::read_dir(dir.join("sessions")) else { return 0 };
    rd.flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|k| safe_key(k)).map(|k| prune_key(dir, &k, days, t)).sum()
}

/// 使わなくなった PC の記録を消す。いま使っている PC は消さない。
pub fn forget(dir: &Path, k: &str, t: Now) -> Result<(), String> {
    if !safe_key(k) {
        return Err("鍵の形が違います".into());
    }
    if active(&read(&dir.join("now").join(format!("{k}.json"))).unwrap_or_default(), t) {
        return Err("いま使っている PC の記録は消せません（閉じてから消してください）".into());
    }
    let _ = std::fs::remove_file(dir.join("now").join(format!("{k}.json")));
    let _ = std::fs::remove_file(dir.join("history").join(format!("{k}.json")));
    let _ = std::fs::remove_dir_all(dir.join("sessions").join(k));
    Ok(())
}

fn active(now_file: &Value, t: Now) -> bool {
    !now_file["left"].as_bool().unwrap_or(false) && parse(&now_file["at"]).is_some_and(|a| (t - a).num_seconds() <= TTL_SEC)
}

fn ver(v: &str) -> (u64, u64, u64) {
    crate::release::parse_version(v).unwrap_or((0, 0, 0))
}

/// PC ごとの状況。latest: 配る版（決まっていれば。distributed）か、使っている人（開発者を除く）のいちばん新しい版。
/// 要更新（behind）: 配る版が決まっていれば、それと違う版（新しすぎる版も戻させる）。決まっていなければ latest より古い版。開発者は対象外。
/// 並びは 要更新 → 使用中 → PC 名 → ログイン名。読んだついでに、古い「いま使っている印」（TTL の 4 倍より古い）を消す。
pub fn fleet(dir: &Path, distributed: Option<&str>, t: Now) -> Value {
    let mut rows: Vec<Value> = vec![];
    if let Ok(rd) = std::fs::read_dir(dir.join("history")) {
        for e in rd.flatten() {
            let Some(h) = read(&e.path()).filter(Value::is_object) else { continue };
            let k = h["key"].as_str().unwrap_or("").to_string();
            if !safe_key(&k) {
                continue;
            }
            let nf = read(&dir.join("now").join(format!("{k}.json"))).unwrap_or_default();
            let on = active(&nf, t);
            let version = nf["version"].as_str().filter(|_| on).or(h["version"].as_str()).unwrap_or("").to_string();
            let last = parse(&nf["at"]).max(parse(&h["lastAt"]));
            let mut r = h.clone();
            r["active"] = json!(on);
            r["version"] = json!(version);
            r["lastAt"] = json!(last.map(ts));
            r["agoSec"] = json!(last.map(|l| (t - l).num_seconds().max(0)));
            r["nudged"] = read(&dir.join("nudge").join(format!("{k}.json"))).unwrap_or(Value::Null);
            rows.push(r);
        }
    }
    if let Ok(rd) = std::fs::read_dir(dir.join("now")) {
        for e in rd.flatten() {
            if read(&e.path()).and_then(|v| parse(&v["at"])).is_some_and(|a| (t - a).num_seconds() > TTL_SEC * 4) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let users = |r: &&Value| !r["developer"].as_bool().unwrap_or(false);
    let latest = distributed
        .map(str::to_string)
        .or_else(|| rows.iter().filter(users).filter_map(|r| r["version"].as_str()).max_by_key(|v| ver(v)).map(str::to_string));
    for r in rows.iter_mut() {
        let v = r["version"].as_str().unwrap_or("").to_string();
        let dev = r["developer"].as_bool().unwrap_or(false);
        let behind = !dev
            && match (distributed, &latest) {
                (Some(d), _) => v != d,
                (None, Some(l)) => ver(&v) < ver(l),
                _ => false,
            };
        r["behind"] = json!(behind);
    }
    rows.sort_by(|a, b| {
        let f = |r: &Value| (!r["behind"].as_bool().unwrap_or(false), !r["active"].as_bool().unwrap_or(false));
        f(a).cmp(&f(b))
            .then_with(|| a["pc"].as_str().unwrap_or("").to_lowercase().cmp(&b["pc"].as_str().unwrap_or("").to_lowercase()))
            .then_with(|| a["login"].as_str().cmp(&b["login"].as_str()))
    });
    let count = |f: &dyn Fn(&Value) -> bool| rows.iter().filter(|r| f(r)).count();
    json!({"latest": latest, "distributed": distributed, "at": ts(t), "ttlSec": TTL_SEC, "historyDays": history_days(dir),
           "counts": {"active": count(&|r| r["active"].as_bool().unwrap_or(false)), "behind": count(&|r| r["behind"].as_bool().unwrap_or(false)),
                      "all": rows.len()},
           "rows": rows})
}

/// 使用の履歴（新しい順）。key があればその PC だけ。前の使い始めから版が変わった行に changedFrom。
pub fn sessions(dir: &Path, only: Option<&str>, limit: usize) -> Vec<Value> {
    let keys: Vec<String> = match only {
        Some(k) if safe_key(k) => vec![k.to_string()],
        Some(_) => vec![],
        None => std::fs::read_dir(dir.join("sessions"))
            .map(|rd| rd.flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|k| safe_key(k)).collect())
            .unwrap_or_default(),
    };
    let mut all: Vec<Value> = vec![];
    for k in keys {
        let mut mine: Vec<Value> = vec![];
        let Ok(rd) = std::fs::read_dir(dir.join("sessions").join(&k)) else { continue };
        for e in rd.flatten() {
            let Some(m) = read(&e.path()) else { continue };
            for s in m["sessions"].as_array().cloned().unwrap_or_default() {
                let mut s = s;
                s["key"] = json!(k);
                s["login"] = m["login"].clone();
                s["pc"] = m["pc"].clone();
                mine.push(s);
            }
        }
        mine.sort_by(|a, b| a["start"].as_str().cmp(&b["start"].as_str()));
        for i in 1..mine.len() {
            if mine[i]["version"] != mine[i - 1]["version"] {
                mine[i]["changedFrom"] = mine[i - 1]["version"].clone();
            }
        }
        all.extend(mine);
    }
    all.sort_by(|a, b| b["start"].as_str().cmp(&a["start"].as_str()));
    all.truncate(limit);
    all
}

/// 共有の置き場（shared）の下の使用状況の置き場。
pub fn dir_of(shared: &Path) -> PathBuf {
    shared.join("presence")
}

/// 配る版（共有の置き場の 1 つ上〈アプリのフォルダ〉の distribute.json の version）。
pub fn distributed(shared: &Path) -> Option<String> {
    read(&shared.parent()?.join("distribute.json")).and_then(|v| v["version"].as_str().map(str::to_string)).filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> Now {
        chrono::NaiveDateTime::parse_from_str(s, FMT).unwrap()
    }

    #[test]
    fn keys_are_safe_file_names_and_do_not_collide() {
        assert_eq!(key("sato", "PC-01"), "PC-01@sato");
        let a = key("a/b", "PC");
        let b = key("a:b", "PC");
        assert!(safe_key(&a) && safe_key(&b) && a != b, "{a} {b}");
        assert!(!safe_key("../x") && !safe_key("") && !safe_key("a\\b"));
    }

    #[test]
    fn heartbeats_make_sessions_and_the_fleet_says_who_is_behind() {
        let d = std::env::temp_dir().join(format!("dt-presence-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let (s1, s2, s3) = (Session::default(), Session::default(), Session::default());
        let me = |login, pc, version, developer| Me { login, pc, version, developer };
        s1.beat(&d, &me("sato", "PC1", "4.6.0", false), at("2026-10-28T08:00:00"), false).unwrap();
        s1.beat(&d, &me("sato", "PC1", "4.6.0", false), at("2026-10-28T08:00:20"), false).unwrap();
        s2.beat(&d, &me("kato", "PC2", "4.5.0", false), at("2026-10-28T07:00:00"), false).unwrap();
        s3.beat(&d, &me("dev", "PC3", "4.7.0", true), at("2026-10-28T08:00:10"), false).unwrap();
        // 間が空いたら新しい使い始め
        s1.beat(&d, &me("sato", "PC1", "4.6.1", false), at("2026-10-28T09:00:00"), false).unwrap();
        let f = fleet(&d, None, at("2026-10-28T09:00:30"));
        assert_eq!(f["latest"], "4.6.1", "開発者の 4.7.0 は数えない");
        let row = |k: &str| f["rows"].as_array().unwrap().iter().find(|r| r["key"] == k).unwrap().clone();
        assert_eq!((row("PC1@sato")["active"].as_bool(), row("PC1@sato")["sessions"].as_i64()), (Some(true), Some(2)));
        assert_eq!(row("PC1@sato")["totalSec"], 20);
        assert_eq!((row("PC2@kato")["active"].as_bool(), row("PC2@kato")["behind"].as_bool()), (Some(false), Some(true)));
        assert_eq!(row("PC3@dev")["behind"], false, "開発者は対象外");
        assert_eq!(f["rows"][0]["key"], "PC2@kato", "要更新が先");
        // 配る版が決まっていれば、それと違う版は（新しすぎても）要更新
        let f = fleet(&d, Some("4.6.0"), at("2026-10-28T09:00:30"));
        let behind: Vec<&str> =
            f["rows"].as_array().unwrap().iter().filter(|r| r["behind"] == true).filter_map(|r| r["key"].as_str()).collect();
        assert_eq!(behind.len(), 2, "{behind:?}");
        // 履歴: 新しい順・版が変わった印
        let h = sessions(&d, Some("PC1@sato"), 10);
        assert_eq!((h.len(), h[0]["changedFrom"].as_str()), (2, Some("4.6.0")));
        // 閉じたら使っていない・使っている PC は消せない・閉じれば消せる
        assert!(forget(&d, "PC1@sato", at("2026-10-28T09:00:30")).is_err());
        s1.beat(&d, &me("sato", "PC1", "4.6.1", false), at("2026-10-28T09:00:40"), true).unwrap();
        assert_eq!(fleet(&d, None, at("2026-10-28T09:00:45"))["counts"]["active"], 0, "閉じた PC1 は使っていない（PC2・PC3 は TTL 切れ）");
        assert!(forget(&d, "PC1@sato", at("2026-10-28T09:00:45")).is_ok());
        assert!(forget(&d, "../x", at("2026-10-28T09:00:45")).is_err());
        // 更新のお願い: 置くと fleet に出て、その PC がその版になったら消える
        nudge(&d, "PC2@kato", "4.6.0", "dev", at("2026-10-28T09:01:00")).unwrap();
        assert_eq!(
            fleet(&d, None, at("2026-10-28T09:01:00"))["rows"].as_array().unwrap().iter().find(|r| r["key"] == "PC2@kato").unwrap()
                ["nudged"]["by"],
            "dev"
        );
        assert!(my_nudge(&d, "PC2@kato", "4.5.0").is_some());
        assert!(my_nudge(&d, "PC2@kato", "4.6.0").is_none() && my_nudge(&d, "PC2@kato", "4.5.0").is_none(), "その版になったら消える");
        assert!(nudge(&d, "../x", "4.6.0", "dev", at("2026-10-28T09:01:00")).is_err());
        // 残す日数より古い記録を消す
        set_history_days(&d, 30, "dev").unwrap();
        assert_eq!(prune_all(&d, at("2026-12-28T09:00:00")), 2);
        assert!(set_history_days(&d, 5, "dev").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }
}
