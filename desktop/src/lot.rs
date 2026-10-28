//! 1 ロットの資源（ファイルの一覧・.dat・条件の XML）と、ロットの値・確かめ（多量・欠陥数上限・日時の整合・分類別の数）。
//! 版 3.8 の Python 版（app.py の LotRes・lot_info・overload_count・time_check など）と同じ答えを返す（tests/golden.rs が確かめる）。

use crate::cache::Lru;
use crate::config::Config;
use crate::dat::{self, Dat, Rec, V};
use crate::pyfmt::{fixed, fmt_float, natcmp, py_repr, round_to};
use crate::xml;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

pub const KIND_KEYS: [&str; 3] = ["kindID", "kindID2", "original_kindID"];
pub const IMG_EXT: [&str; 6] = ["bmp", "jpg", "jpeg", "png", "tif", "tiff"];

pub fn is_image(name: &str) -> bool {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).is_some_and(|e| IMG_EXT.contains(&e.as_str()))
}

// ------------------------------------------------------------------ 値の書き方
/// Python の `str(v)`。
pub fn py_str(v: &V) -> String {
    match v {
        V::Null | V::T(_) => "None".into(),
        V::I(i) => i.to_string(),
        V::U(u) => u.to_string(),
        V::F(f) => py_repr(*f),
        V::B(b) => if *b { "True" } else { "False" }.into(),
        V::S(s) => s.clone(),
        V::L(l) => format!("[{}]", l.iter().map(py_str).collect::<Vec<_>>().join(", ")),
    }
}

/// 版 3.8 の fmt_val。
pub fn fmt_val(v: &V) -> String {
    match v {
        V::F(f) => fmt_float(*f),
        V::L(l) => {
            let s: Vec<String> = l.iter().take(16).map(fmt_val).collect();
            s.join(" ") + if l.len() > 16 { " …" } else { "" }
        }
        V::Null | V::T(_) => String::new(),
        V::S(s) => s.trim().to_string(),
        other => py_str(other),
    }
}

/// 版 3.8 の fmt_num（数は小数 2 桁。単位の倍率があれば掛ける）。
pub fn fmt_num(v: &V, scale: Option<f64>) -> String {
    let scale = scale.filter(|s| *s != 0.0);
    match (v, scale) {
        (V::I(i), None) => i.to_string(),
        (V::U(u), None) => u.to_string(),
        (V::I(_) | V::U(_) | V::F(_), _) => fixed(v.num().unwrap_or(0.0) * scale.unwrap_or(1.0), 2),
        _ => fmt_val(v),
    }
}

fn sub(a: Option<&V>, b: Option<&V>) -> Option<f64> {
    Some(a?.num()? - b?.num()?)
}

/// 計算で作る項目（鍵・名前・a − b の 2 つの欄）。DETECT_INFO の @os_x、INSP_INFO の @insp_width。
pub const VIRTUALS: [(&str, &str, [&str; 2]); 2] =
    [("@os_x", "幅方向OS～(mm)", ["x_mm", "base_x"]), ("@insp_width", "検査幅(mm)", ["insp_area_ed", "insp_area_st"])];

pub fn virtual_label(key: &str) -> Option<&'static str> {
    VIRTUALS.iter().find(|v| v.0 == key).map(|v| v.1)
}

/// この .dat から作れる計算の項目（両方の欄がある物）。
pub fn virtuals_of(d: &Dat) -> impl Iterator<Item = &'static (&'static str, &'static str, [&'static str; 2])> + '_ {
    VIRTUALS.iter().filter(|v| v.2.iter().all(|f| d.col(f).is_some()))
}

/// 1 件の値（計算で作る項目も）。無ければ None。
pub fn rec_get(d: &Dat, r: &Rec, key: &str) -> Option<V> {
    match VIRTUALS.iter().find(|v| v.0 == key) {
        Some((_, _, [a, b])) => sub(d.get(r, a), d.get(r, b)).map(V::F),
        None => d.get(r, key).cloned(),
    }
}

pub fn to_num(v: Option<&V>, scale: Option<f64>) -> Option<f64> {
    let x = v?.num()?;
    Some(match scale.filter(|s| *s != 0.0) {
        Some(s) => x * s,
        None => x,
    })
}

pub fn rgb(s: Option<&str>, default: &str) -> String {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = R.get_or_init(|| Regex::new(r"^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$").unwrap());
    match s.and_then(|s| r.captures(s)) {
        Some(c) => format!("rgb({},{},{})", &c[1], &c[2], &c[3]),
        None => default.into(),
    }
}

/// ロットのフォルダ名（yyyy_mm_dd_hh_mm_ss）の 6 つの数字。
pub fn lot_parts(name: &str) -> Option<[String; 6]> {
    static R: OnceLock<Regex> = OnceLock::new();
    let c = R.get_or_init(|| Regex::new(r"^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})").unwrap()).captures(name)?;
    Some(std::array::from_fn(|i| c[i + 1].to_string()))
}

pub fn lot_dt(name: &str) -> (String, String) {
    match lot_parts(name) {
        Some([y, mo, d, h, mi, s]) => (format!("{y}/{mo}/{d}"), format!("{h}:{mi}:{s}")),
        None => (String::new(), String::new()),
    }
}

/// フォルダ名から作る値（"@lot" の項目: 作業時刻・作業日）。
pub fn lot_meta_value(name: &str, key: &str, fmt: Option<&str>) -> String {
    let Some([y, mo, d, h, mi, s]) = lot_parts(name) else { return String::new() };
    match key {
        "time" if fmt.unwrap_or("hhmm") == "hhmm" => format!("{h}:{mi}"),
        "time" => format!("{h}:{mi}:{s}"),
        "date" if fmt == Some("mmdd") => format!("{mo}/{d}"),
        "date" => format!("{y}/{mo}/{d}"),
        _ => String::new(),
    }
}

pub const LOT_META: [(&str, &str); 2] = [("time", "作業時刻"), ("date", "作業日")];

// ------------------------------------------------------------------ 小さなワイルドカード（* と ?・大文字小文字を区別しない）
pub fn wild(pat: &str, name: &str) -> bool {
    let p: Vec<char> = pat.to_lowercase().chars().collect();
    let n: Vec<char> = name.to_lowercase().chars().collect();
    let (mut i, mut j, mut star, mut mark) = (0, 0, None, 0);
    while j < n.len() {
        if i < p.len() && (p[i] == '?' || p[i] == n[j]) {
            i += 1;
            j += 1;
        } else if i < p.len() && p[i] == '*' {
            star = Some(i);
            mark = j;
            i += 1;
        } else if let Some(s) = star {
            i = s + 1;
            mark += 1;
            j = mark;
        } else {
            return false;
        }
    }
    while i < p.len() && p[i] == '*' {
        i += 1;
    }
    i == p.len()
}

/// lot の下で "cond/COND*.xml" のような形に合うファイル（名前の数の順）。
pub fn glob(root: &Path, pattern: &str) -> Vec<PathBuf> {
    let parts: Vec<&str> = pattern.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    let mut cur = vec![root.to_path_buf()];
    for (k, part) in parts.iter().enumerate() {
        let last = k + 1 == parts.len();
        let mut next = vec![];
        for d in &cur {
            let Ok(rd) = std::fs::read_dir(d) else { continue };
            let mut found: Vec<PathBuf> = rd
                .flatten()
                .filter(|e| wild(part, &e.file_name().to_string_lossy()))
                .filter(|e| if last { e.path().is_file() } else { e.path().is_dir() })
                .map(|e| e.path())
                .collect();
            found.sort_by(|a, b| natcmp(&name_of(a), &name_of(b)));
            next.extend(found);
        }
        cur = next;
    }
    cur
}

pub fn name_of(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// 相対パスの終わりが形に合うか（pathlib の match と同じく右から比べる）。
fn path_match(rel: &str, pat: &str) -> bool {
    let r: Vec<&str> = rel.split('/').collect();
    let p: Vec<&str> = pat.split('/').collect();
    p.len() <= r.len() && r[r.len() - p.len()..].iter().zip(&p).all(|(a, b)| wild(b, a))
}

// ------------------------------------------------------------------ ロットの資源
#[derive(Debug, Clone)]
pub struct Side {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone)]
pub struct Kind {
    pub name: String,
    pub mark: String,
    pub color: String,
}

#[derive(Debug, Clone, Default)]
pub struct Cam {
    pub group: i64,
    pub no: usize,
    pub lsc: Option<String>,
    pub st: Option<f64>,
    pub ed: Option<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct System {
    pub cams: BTreeMap<i64, Cam>,
    pub scan: BTreeMap<i64, Option<String>>,
}

pub struct LotRes {
    pub lot: PathBuf,
    /// 小文字の名前 → 最初に見つけた場所（img・fm_img・wavedata の下は見ない。wavedata/cond だけは見る）
    pub files: HashMap<String, PathBuf>,
    pub rel: Vec<PathBuf>,
    cfg: Arc<Config>,
    program: Option<PathBuf>,
    dats: Mutex<HashMap<String, Arc<Dat>>>,
    defs: OnceLock<Option<Arc<dat::Defs>>>,
    kinds: OnceLock<BTreeMap<String, Kind>>,
    sides: OnceLock<BTreeMap<i64, Side>>,
    system: OnceLock<System>,
}

const WALK_SKIP: [&str; 3] = ["img", "fm_img", "wavedata"];

fn walk(dir: &Path, files: &mut HashMap<String, PathBuf>, rel: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut subs = vec![];
    let mut here = vec![];
    for e in rd.flatten() {
        let Ok(t) = e.file_type() else { continue };
        let p = e.path();
        let is_dir = t.is_dir() || (t.is_symlink() && p.is_dir());
        if is_dir {
            if !WALK_SKIP.contains(&e.file_name().to_string_lossy().to_lowercase().as_str()) {
                subs.push(p);
            }
        } else {
            here.push(p);
        }
    }
    here.sort();
    subs.sort();
    for p in here {
        files.entry(name_of(&p).to_lowercase()).or_insert_with(|| p.clone());
        rel.push(p);
    }
    for s in subs {
        walk(&s, files, rel);
    }
}

impl LotRes {
    pub fn new(lot: &Path, cfg: Arc<Config>, program: Option<PathBuf>) -> LotRes {
        let (mut files, mut rel) = (HashMap::new(), vec![]);
        walk(lot, &mut files, &mut rel);
        // COND*.xml・Common.xml が wavedata/cond にだけあるロット（README 版 3.6 の約束。版 3.8 までは walk が飛ばしていた）
        if let Some(wd) = std::fs::read_dir(lot)
            .ok()
            .and_then(|rd| rd.flatten().find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case("wavedata")).map(|e| e.path()))
        {
            if let Some(cd) = std::fs::read_dir(&wd)
                .ok()
                .and_then(|rd| rd.flatten().find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case("cond")).map(|e| e.path()))
            {
                let mut fs: Vec<PathBuf> =
                    std::fs::read_dir(&cd).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
                fs.sort();
                for p in fs {
                    files.entry(name_of(&p).to_lowercase()).or_insert(p);
                }
            }
        }
        LotRes {
            lot: lot.to_path_buf(),
            files,
            rel,
            cfg,
            program,
            dats: Mutex::default(),
            defs: OnceLock::new(),
            kinds: OnceLock::new(),
            sides: OnceLock::new(),
            system: OnceLock::new(),
        }
    }

    /// ロットの中のファイルを形（cond/COND*.xml など）で探す。開いたときにたどった一覧から探し、フォルダを読み直さない
    /// （共有フォルダでは、フォルダの一覧を読むたびに行き来の待ちがかかる）。一覧に無い img・fm_img・wavedata の下はディスクで探す
    pub fn glob(&self, pattern: &str) -> Vec<PathBuf> {
        let parts: Vec<&str> = pattern.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
        if parts.len() > 1 && WALK_SKIP.contains(&parts[0].to_lowercase().as_str()) {
            return glob(&self.lot, pattern);
        }
        let comps = |p: &Path| -> Vec<String> {
            p.strip_prefix(&self.lot)
                .map(|r| r.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect())
                .unwrap_or_default()
        };
        let mut out: Vec<(Vec<String>, PathBuf)> = self
            .rel
            .iter()
            .map(|p| (comps(p), p.clone()))
            .filter(|(c, _)| c.len() == parts.len() && c.iter().zip(&parts).all(|(n, w)| wild(w, n)))
            .collect();
        // 並びは glob と同じ（段ごとに名前の自然な順）
        out.sort_by(|a, b| a.0.iter().zip(&b.0).map(|(x, y)| natcmp(x, y)).find(|o| o.is_ne()).unwrap_or(std::cmp::Ordering::Equal));
        out.into_iter().map(|(_, p)| p).collect()
    }

    pub fn cfg(&self) -> &Config {
        &self.cfg
    }

    /// 名前でファイルを探す（ロットの中 → 設定の defs_dir → アプリの program/defs）。
    pub fn find(&self, name: &str) -> Option<PathBuf> {
        if let Some(p) = self.files.get(&name.to_lowercase()) {
            return Some(p.clone());
        }
        let d = self.cfg.str("defs_dir");
        if !d.is_empty() {
            let q = Path::new(&d).join(name);
            if q.exists() {
                return Some(q);
            }
        }
        self.program.as_ref().map(|p| p.join("defs").join(name)).filter(|q| q.exists())
    }

    pub fn defs(&self) -> Option<Arc<dat::Defs>> {
        self.defs.get_or_init(|| self.find("InspectDataInfo.xml").and_then(|p| dat::load_defs(&p).ok())).clone()
    }

    /// ロットのフォルダ名の時刻。
    pub fn ref_time(&self) -> Option<dat::DateTime> {
        let [y, mo, d, h, mi, s] = lot_parts(&name_of(&self.lot))?;
        let n = |x: &str| x.parse::<u32>().ok();
        chrono::NaiveDate::from_ymd_opt(y.parse().ok()?, n(&mo)?, n(&d)?)?.and_hms_opt(n(&h)?, n(&mi)?, n(&s)?)
    }

    /// .dat を読む（ロットごとに覚える）。
    /// 覚えの重さ: 読んだ .dat の大きさ＋ファイルの一覧（だいたいのバイト）。
    pub fn bytes(&self) -> usize {
        4096 + self.rel.len() * 160 + self.dats.lock().unwrap().values().map(|d| d.bytes).sum::<usize>()
    }

    /// 欄を選んで読んだ .dat（数えるだけのとき。全部を読んだ物があればそれを使う）。覚えは「名前#欄」で別に持つ。
    pub fn dat_cols(&self, name: &str, cols: &[&str]) -> Arc<Dat> {
        let key = format!("{name}#{}", cols.join(","));
        {
            let m = self.dats.lock().unwrap();
            if let Some(d) = m.get(name).or_else(|| m.get(&key)) {
                return d.clone();
            }
        }
        let d = Arc::new(match (self.find(&format!("{name}.dat")), self.defs()) {
            (None, _) => Dat::empty(name, "ファイルなし"),
            (_, None) => Dat::empty(name, "InspectDataInfo.xml が見つかりません"),
            (Some(p), Some(defs)) => dat::read_dat_cols(&p, &defs, name, cols, self.ref_time(), self.cfg.utc_offset()),
        });
        self.dats.lock().unwrap().entry(key).or_insert(d).clone()
    }

    pub fn dat(&self, name: &str) -> Arc<Dat> {
        if let Some(d) = self.dats.lock().unwrap().get(name) {
            return d.clone();
        }
        let d = Arc::new(match (self.find(&format!("{name}.dat")), self.defs()) {
            (None, _) => Dat::empty(name, "ファイルなし"),
            (_, None) => Dat::empty(name, "InspectDataInfo.xml が見つかりません"),
            (Some(p), Some(defs)) => dat::read_dat(&p, &defs, name, 300_000, self.ref_time(), self.cfg.utc_offset()),
        });
        self.dats.lock().unwrap().entry(name.to_string()).or_insert(d).clone()
    }

    pub fn xml_labels_for(&self, rel: &str) -> Arc<HashMap<String, String>> {
        let rel = rel.replace('\\', "/");
        if let Some(m) = self.cfg.v["xml_defs"].as_object() {
            for (pat, defname) in m {
                if path_match(&rel, pat) {
                    return self.find(defname.as_str().unwrap_or("")).map(|p| xml::def_labels(&p)).unwrap_or_default();
                }
            }
        }
        let stem = Path::new(&rel).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        self.find(&format!("{stem}Def.xml")).map(|p| xml::def_labels(&p)).unwrap_or_default()
    }

    pub fn cond_xml(&self) -> Option<PathBuf> {
        if let Some(p) = self.glob("cond/COND*.xml").into_iter().next() {
            return Some(p);
        }
        static R: OnceLock<Regex> = OnceLock::new();
        let r = R.get_or_init(|| Regex::new(r"^cond\d+\.xml$").unwrap());
        let mut c: Vec<&PathBuf> = self.files.iter().filter(|(n, _)| r.is_match(n)).map(|(_, p)| p).collect();
        c.sort_by(|a, b| natcmp(&name_of(a), &name_of(b)));
        c.first().map(|p| (*p).clone())
    }

    /// 面（group 番号 → 名前・色。Common.xml の group_conditions）。
    pub fn sides(&self) -> &BTreeMap<i64, Side> {
        self.sides.get_or_init(|| {
            static R: OnceLock<Regex> = OnceLock::new();
            let r = R.get_or_init(|| Regex::new(r"^condition/group_conditions/group(?:\[(\d+)\])?/(disp_name|disp_color)@value$").unwrap());
            let mut out: BTreeMap<i64, (Option<String>, Option<String>)> = BTreeMap::new();
            let cands = [Some(self.lot.join("cond").join("Common.xml")), self.files.get("common.xml").cloned(), self.cond_xml()];
            for p in cands.into_iter().flatten().filter(|p| p.exists()) {
                for (k, v) in xml::pairs(&p).iter() {
                    if let Some(c) = r.captures(k) {
                        if v.trim().is_empty() {
                            continue;
                        }
                        let i = c.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
                        let e = out.entry(i).or_default();
                        let slot = if &c[2] == "disp_name" { &mut e.0 } else { &mut e.1 };
                        slot.get_or_insert_with(|| v.clone());
                    }
                }
            }
            out.into_iter()
                .map(|(i, (n, c))| (i, Side { name: n.unwrap_or_else(|| format!("G{i}")), color: rgb(c.as_deref(), "#1e5aa8") }))
                .collect()
        })
    }

    pub fn sides_json(&self) -> Value {
        Value::Object(self.sides().iter().map(|(i, s)| (i.to_string(), json!({"name": s.name, "color": s.color}))).collect())
    }

    /// SystemCond.xml: カメラ（全体の通し番号 → 面・面の中の番号・視野）と走査の向き。
    pub fn system(&self) -> &System {
        self.system.get_or_init(|| {
            let mut out = System::default();
            let p = Some(self.lot.join("cond").join("SystemCond.xml")).filter(|p| p.exists()).or_else(|| self.files.get("systemcond.xml").cloned());
            let Some(p) = p.filter(|p| p.exists()) else { return out };
            static R1: OnceLock<Regex> = OnceLock::new();
            static R2: OnceLock<Regex> = OnceLock::new();
            let r1 = R1.get_or_init(|| Regex::new(r"^condition/group_conditions/group(?:\[(\d+)\])?/(camera_amount|scan_direction)@value$").unwrap());
            let r2 = R2.get_or_init(|| {
                Regex::new(
                    r"^condition/group_conditions/group(?:\[(\d+)\])?/camera_conditions/camera_info(?:\[(\d+)\])?/(?:visual_field/(start_mm|end_mm)|configuration_info/(lsc_no))@value$",
                )
                .unwrap()
            });
            type G = (HashMap<String, String>, BTreeMap<i64, HashMap<String, String>>);
            let mut grp: BTreeMap<i64, G> = BTreeMap::new();
            let num = |c: &regex::Captures, i: usize| c.get(i).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
            for (k, v) in xml::pairs(&p).iter() {
                if let Some(c) = r1.captures(k) {
                    grp.entry(num(&c, 1)).or_default().0.insert(c[2].to_string(), v.clone());
                    continue;
                }
                if let Some(c) = r2.captures(k) {
                    let key = c.get(3).or(c.get(4)).map(|m| m.as_str().to_string()).unwrap_or_default();
                    grp.entry(num(&c, 1)).or_default().1.entry(num(&c, 2)).or_default().insert(key, v.clone());
                }
            }
            let mut base = 0i64;
            for (g, (attrs, cams)) in &grp {
                out.scan.insert(*g, attrs.get("scan_direction").cloned());
                let amount = attrs.get("camera_amount").and_then(|v| v.trim().parse::<i64>().ok()).filter(|n| *n != 0);
                let n = amount.unwrap_or(cams.len() as i64);
                for c in 0..n {
                    let ci = cams.get(&c).cloned().unwrap_or_default();
                    let f = |k: &str| ci.get(k).and_then(|v| v.trim().parse::<f64>().ok());
                    out.cams.insert(base + c, Cam { group: *g, no: c as usize + 1, lsc: ci.get("lsc_no").cloned(), st: f("start_mm"), ed: f("end_mm") });
                }
                base += n;
            }
            out
        })
    }

    pub fn cam_label(&self, v: &V) -> String {
        let c = v.num().filter(|x| x.is_finite()).and_then(|x| self.system().cams.get(&(x.trunc() as i64)));
        let Some(c) = c else { return fmt_val(v) };
        let s = side_info(self.sides(), &V::I(c.group)).name;
        let rng = match (c.st, c.ed) {
            (Some(a), Some(b)) => format!(" ({}～{}mm)", fixed(a, 0), fixed(b, 0)),
            _ => String::new(),
        };
        format!("{s} カメラ{}{rng}", c.no)
    }

    /// 分類（kindID → 名前・記号・色。COND*.xml の classification_conditions の並び = kindID）。
    pub fn kinds(&self) -> &BTreeMap<String, Kind> {
        self.kinds.get_or_init(|| {
            static R: OnceLock<Regex> = OnceLock::new();
            let r = R.get_or_init(|| {
                Regex::new(r"^condition/classification_conditions/classification_condition(?:\[(\d+)\])?/(name|map_mark|mark_color)@value$")
                    .unwrap()
            });
            let mut out: BTreeMap<i64, HashMap<String, String>> = BTreeMap::new();
            if let Some(p) = self.cond_xml() {
                for (k, v) in xml::pairs(&p).iter() {
                    if let Some(c) = r.captures(k) {
                        let i = c.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
                        out.entry(i).or_default().insert(c[2].to_string(), v.clone());
                    }
                }
            }
            let mut res: BTreeMap<String, Kind> = out
                .into_iter()
                .map(|(i, d)| {
                    (
                        i.to_string(),
                        Kind {
                            name: d.get("name").cloned().unwrap_or_else(|| format!("分類{i}")),
                            mark: d.get("map_mark").cloned().unwrap_or_else(|| "●".into()),
                            color: rgb(d.get("mark_color").map(String::as_str), "#333"),
                        },
                    )
                })
                .collect();
            if let Some(m) = self.cfg.v["kind_names"].as_object() {
                for (k, v) in m {
                    let e = res.entry(k.clone()).or_insert(Kind { name: String::new(), mark: "●".into(), color: "#333".into() });
                    e.name = match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                }
            }
            res
        })
    }

    pub fn kinds_json(&self) -> Value {
        Value::Object(self.kinds().iter().map(|(k, x)| (k.clone(), json!({"name": x.name, "mark": x.mark, "color": x.color}))).collect())
    }

    pub fn kind_info(&self, v: Option<&V>) -> Kind {
        kind_info(self.kinds(), v, &self.cfg.ints("overload_kind_ids"))
    }
}

pub fn kind_info(kinds: &BTreeMap<String, Kind>, v: Option<&V>, overload_ids: &[i64]) -> Kind {
    let key = v.map(py_str).unwrap_or_else(|| "None".into());
    if let Some(k) = kinds.get(&key) {
        return k.clone();
    }
    let ids: &[i64] = if overload_ids.is_empty() { &[1100] } else { overload_ids };
    if let Some(i) = v.and_then(py_int) {
        if ids.contains(&i) {
            return Kind { name: "多量".into(), mark: "■".into(), color: "#c62828".into() };
        }
    }
    Kind { name: v.map(|x| format!("分類{}", py_str(x))).unwrap_or_default(), mark: "●".into(), color: "#333".into() }
}

/// Python の `int(v)`（数は 0 の向きへ切り捨て・文字は整数の形だけ）。
pub fn py_int(v: &V) -> Option<i64> {
    match v {
        V::I(i) => Some(*i),
        V::B(b) => Some(*b as i64),
        V::F(f) if f.is_finite() => Some(f.trunc() as i64),
        V::S(s) => s.trim().parse().ok(),
        _ => None,
    }
}

pub fn side_info(sides: &BTreeMap<i64, Side>, v: &V) -> Side {
    match py_int(v) {
        Some(i) => sides.get(&i).cloned().unwrap_or_else(|| Side { name: format!("G{}", py_str(v)), color: "#1e5aa8".into() }),
        None => Side { name: String::new(), color: "#888".into() },
    }
}

/// ロットの資源を覚える（読んだ .dat の大きさの合計が LOT_CACHE_BYTES まで。使った順に捨てる）。
/// 画像の画面は開いているロットを何度も問い合わせ、ロット表・木の札は多くのロットを 1 度ずつ読む。どちらでもメモリが増え続けない
pub const LOT_CACHE_BYTES: usize = 384 << 20;

pub struct LotCache {
    m: Lru<String, Arc<LotRes>>,
}

impl Default for LotCache {
    fn default() -> Self {
        LotCache { m: Lru::weighed(LOT_CACHE_BYTES, |r| r.bytes()) }
    }
}

impl LotCache {
    pub fn get(&self, path: &str, cfg: &Arc<Config>, program: Option<&PathBuf>) -> Result<Arc<LotRes>, String> {
        // .dat は使うときに読むので、覚えた後で重くなる。重さは捨てるかを決める前に量り直す（Lru::weighed）
        if let Some(r) = self.m.get(&path.to_string()) {
            return Ok(r);
        }
        let lot = Path::new(path);
        if !lot.is_dir() {
            return Err("lot not found".into());
        }
        let r = Arc::new(LotRes::new(lot, cfg.clone(), program.cloned()));
        let w = r.bytes();
        Ok(self.m.insert(path.to_string(), r, w))
    }

    /// 覚えている数と重さ（確かめ用）。
    pub fn stats(&self) -> (usize, usize) {
        self.m.stats()
    }

    /// 覚えを捨てる（「読み直す」。次に問い合わせたとき、ロットを読み直す）。
    pub fn forget(&self, paths: &[String]) {
        for p in paths {
            self.m.remove(p);
        }
    }

    pub fn clear(&self) {
        self.m.clear();
    }
}

// ------------------------------------------------------------------ 表示項目の値
/// ロット単位の表示項目の値。
pub fn resolve_lot_pin(res: &LotRes, p: &Value) -> String {
    let file = p["file"].as_str().unwrap_or("");
    let key = p["key"].as_str().unwrap_or("");
    if file == "@lot" {
        return lot_meta_value(&name_of(&res.lot), key, p["fmt"].as_str());
    }
    if let Some(name) = file.strip_prefix("dat:") {
        let d = res.dat(name);
        let Some(r) = d.first() else { return String::new() };
        let scale = p["scale"].as_f64();
        return match rec_get(&d, r, key) {
            Some(v) if scale.is_some() => fmt_num(&v, scale),
            Some(v) => fmt_val(&v),
            None => String::new(),
        };
    }
    for fp in res.glob(file) {
        let vals = xml::match_values(&xml::pairs(&fp), key);
        if !vals.is_empty() {
            return vals.into_iter().filter(|v| !v.is_empty()).collect::<Vec<_>>().join(" ");
        }
    }
    String::new()
}

/// 1 件の項目の値（面・分類は名前・カメラは「面 カメラn（視野）」）。
pub fn rec_value(p: &Value, d: &Dat, r: Option<&Rec>, res: &LotRes, card: bool) -> String {
    let key = p["key"].as_str().unwrap_or("");
    let Some(r) = r else { return String::new() };
    let Some(v) = rec_get(d, r, key) else { return String::new() };
    if v == V::Null {
        return String::new();
    }
    if key == "camera" {
        return res.cam_label(&v);
    }
    if key == "group" {
        return side_info(res.sides(), &v).name;
    }
    if KIND_KEYS.contains(&key) {
        return res.kind_info(Some(&v)).name;
    }
    let scale = p["scale"].as_f64().filter(|s| *s != 0.0);
    if card || scale.is_some() {
        return fmt_num(&v, scale);
    }
    fmt_val(&v)
}

// ------------------------------------------------------------------ 確かめ
/// 多量（検査計の処理落ち）の確かめ。
/// 1. INSP_INFO.error_count（定義の説明「多量集計数」）2. DETECT_INFO の type=2・kindID=1100 3. 分類名「多量」（予備）
pub fn overload_count(res: &LotRes, detail: bool) -> Value {
    let cfg = res.cfg();
    let names: Vec<String> = cfg.strs("overload_names").into_iter().filter(|n| !n.is_empty()).collect();
    let ok: BTreeMap<String, String> = res
        .kinds()
        .iter()
        .filter(|(_, v)| names.iter().any(|n| v.name.contains(n.as_str())))
        .map(|(k, v)| (k.clone(), v.name.clone()))
        .collect();
    let insp = res.dat("INSP_INFO");
    let ir = insp.first();
    let g = |k: &str| ir.and_then(|r| insp.get(r, k)).cloned().unwrap_or(V::Null);
    let ec = match g("error_count") {
        V::I(i) => Some(i),
        _ => None,
    };
    let mut out = json!({"defined": ec.is_some() || !ok.is_empty(), "names": ["多量"], "count": null, "by": null, "sides": {},
        "insp_count": ec, "detect_max_status": g("detect_max_status").to_json(), "events": 0, "cams": {},
        "detect_total": g("detect_total_cnt").to_json(), "image_total": g("image_total_cnt").to_json(), "y_first": null, "y_last": null});
    if let Some(ec) = ec {
        out["count"] = json!(ec);
        out["by"] = json!("INSP_INFO.error_count");
    } else if !ok.is_empty() {
        if let V::L(cc) = g("classification_count") {
            let vals: Vec<i64> =
                ok.keys().filter_map(|k| k.parse::<usize>().ok()).filter_map(|i| cc.get(i).and_then(V::int)).filter(|v| *v >= 0).collect();
            if !vals.is_empty() {
                out["count"] = json!(vals.iter().sum::<i64>());
                out["by"] = json!("INSP_INFO.classification_count");
            }
        }
    }
    if !detail && !out["count"].is_null() {
        return out;
    }
    // 数えるのに使う欄だけを読む（全部を読んだ物があればそれ）
    let det = res.dat_cols("DETECT_INFO", &["type", "kindID", "group", "camera", "y_mm"]);
    if !det.records.is_empty() && det.error.is_none() {
        let types = cfg.ints("overload_types");
        let types = if types.is_empty() { vec![2] } else { types };
        let kids = cfg.ints("overload_kind_ids");
        let kids = if kids.is_empty() { vec![1100] } else { kids };
        let (mut n, mut ys) = (0i64, std::collections::BTreeSet::new());
        let mut sides: BTreeMap<String, i64> = BTreeMap::new();
        let mut cams: BTreeMap<String, i64> = BTreeMap::new();
        for r in &det.records {
            if !is_overload(&det, r, &types, &kids, &ok) {
                continue;
            }
            n += 1;
            *sides.entry(py_str(det.get(r, "group").unwrap_or(&V::Null))).or_default() += 1;
            *cams.entry(py_str(det.get(r, "camera").unwrap_or(&V::Null))).or_default() += 1;
            if let Some(y) = det.get(r, "y_mm").and_then(V::num) {
                ys.insert((round_to(y, 1) * 10.0).round() as i64);
            }
        }
        out["events"] = json!(ys.len());
        if let (Some(a), Some(b)) = (ys.first(), ys.last()) {
            out["y_first"] = json!(round_to(*a as f64 / 10.0 / 1000.0, 2));
            out["y_last"] = json!(round_to(*b as f64 / 10.0 / 1000.0, 2));
        }
        out["sides"] = json!(sides);
        out["detect_count"] = json!(n);
        if out["count"].is_null() {
            out["count"] = json!(n);
            out["by"] = json!("DETECT_INFO");
            out["defined"] = json!(true);
        }
        let mut cl: Vec<(String, i64)> = cams.into_iter().collect();
        cl.sort_by_key(|(k, _)| k.parse::<i64>().unwrap_or(0));
        let mut cm = Map::new();
        for (k, v) in cl {
            let lab = k.parse::<i64>().map(|i| res.cam_label(&V::I(i))).unwrap_or_else(|_| k.clone());
            cm.insert(lab, json!(v));
        }
        out["cams"] = Value::Object(cm);
    }
    out
}

pub fn is_overload(d: &Dat, r: &Rec, types: &[i64], kind_ids: &[i64], ok: &BTreeMap<String, String>) -> bool {
    if d.get(r, "type").and_then(V::int).is_some_and(|t| types.contains(&t)) {
        return true;
    }
    match d.get(r, "kindID") {
        Some(k) => k.int().is_some_and(|i| kind_ids.contains(&i)) || ok.contains_key(&py_str(k)),
        None => ok.contains_key("None"),
    }
}

/// 一覧の確かめ（INSP_INFO だけを読む）。
pub fn lot_flags(res: &LotRes) -> Value {
    let ov = overload_count(res, false);
    let insp = res.dat("INSP_INFO");
    let g = |k: &str| insp.first().and_then(|r| insp.get(r, k)).map(V::to_json).unwrap_or(Value::Null);
    let tc = time_check(res, true);
    // 画像なし（良品などで検出画像を残していないロット。確かめる画像が無い）: INSP_INFO の画像総数が 0。INSP_INFO が無ければ画像の CAB が無い
    let no_image = match g("image_total_cnt").as_i64() {
        Some(n) => n == 0,
        None => crate::images::image_groups(&res.lot).is_empty(),
    };
    json!({"overload": ov["count"], "overload_defined": ov["defined"], "overload_names": ov["names"],
           "insp_state": g("insp_state"), "error_count": g("error_count"), "detect_max_status": g("detect_max_status"),
           "time_warn": tc["warn"], "time_max_diff": tc["max_diff"], "no_image": no_image})
}

fn parse_dt(s: &str) -> Option<dat::DateTime> {
    chrono::NaiveDateTime::parse_from_str(s, "%Y/%m/%d %H:%M:%S").ok()
}

/// フォルダ名の時刻とデータの時刻を比べる。
pub fn time_check(res: &LotRes, quick: bool) -> Value {
    let refdt = res.ref_time();
    let lim = res.cfg().f64("time_warn_minutes", 10.0);
    let mut rows: Vec<Value> = vec![];
    let insp = res.dat("INSP_INFO");
    let ir = insp.first();
    let ist = |k: &str| ir.and_then(|r| insp.get(r, k)).and_then(V::str).map(str::to_string);
    let end = ist("end_time").as_deref().and_then(parse_dt);
    let day = res.lot.parent().map(name_of).unwrap_or_default();
    static DAY: OnceLock<Regex> = OnceLock::new();
    let lotname = name_of(&res.lot);
    if refdt.is_some()
        && DAY.get_or_init(|| Regex::new(r"^\d{4}_\d{2}_\d{2}$").unwrap()).is_match(&day)
        && lotname.get(..10) != Some(day.as_str())
    {
        rows.push(json!({"label": "日付フォルダ", "value": day.replace('_', "/"), "src": "フォルダ構成", "diff_min": null, "warn": true, "mode": null}));
    }
    let mut add = |label: &str, s: Option<String>, src: &str, mode: Option<&str>, expect: &str| {
        let d = s.as_deref().and_then(parse_dt);
        let diff = match (d, refdt) {
            (Some(d), Some(r)) => Some(round_to((d - r).num_seconds() as f64 / 60.0, 1)),
            _ => None,
        };
        let mut bad = diff.is_some_and(|x| if expect == "near" { x.abs() > lim } else { x < -lim });
        if !bad && expect == "inlot" {
            if let (Some(d), Some(e)) = (d, end) {
                bad = diff.is_some_and(|x| x < -lim) || ((d - e).num_seconds() as f64 / 60.0) > lim;
            }
        }
        rows.push(json!({"label": label, "value": s.unwrap_or_default(), "src": src, "diff_min": diff, "warn": bad, "mode": mode}));
    };
    add("検査開始", ist("start_time"), "INSP_INFO.start_time", insp.dt_mode, "near");
    add("検査終了", ist("end_time"), "INSP_INFO.end_time", insp.dt_mode, "after");
    if !quick {
        let det = res.dat("DETECT_INFO");
        let mut ts: Vec<String> = det
            .records
            .iter()
            .filter_map(|r| det.get(r, "datetime").and_then(V::str))
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        ts.sort();
        if let (Some(a), Some(b)) = (ts.first().cloned(), ts.last().cloned()) {
            add("最初の欠陥", Some(a), "DETECT_INFO.datetime", det.dt_mode, "inlot");
            add("最後の欠陥", Some(b), "DETECT_INFO.datetime", det.dt_mode, "inlot");
        }
        let st = res.dat("STAT_INFO");
        let ts: Vec<String> =
            st.records.iter().filter_map(|r| st.get(r, "time").and_then(V::str)).filter(|s| !s.is_empty()).map(str::to_string).collect();
        if let (Some(a), Some(b)) = (ts.first().cloned(), ts.last().cloned()) {
            add("統計 最初", Some(a), "STAT_INFO.time", st.dt_mode, "inlot");
            add("統計 最後", Some(b), "STAT_INFO.time", st.dt_mode, "inlot");
        }
        let sm = res.dat("SLIT_MASK_STAT");
        if let Some(t) = sm.first().and_then(|r| sm.get(r, "date_time")).and_then(V::str).filter(|s| !s.is_empty()) {
            add("スリット設定", Some(t.to_string()), "SLIT_MASK_STAT.date_time", sm.dt_mode, "near");
        }
    }
    let diffs: Vec<f64> = rows.iter().filter(|r| r["label"] == "検査開始").filter_map(|r| r["diff_min"].as_f64()).map(f64::abs).collect();
    let max_diff = diffs.iter().cloned().fold(None, |m: Option<f64>, x| Some(m.map_or(x, |m| m.max(x))));
    let warn = rows.iter().any(|r| r["warn"] == true);
    json!({"ref": refdt.map(|d| dat::dt_text(&d)).unwrap_or_default(), "rows": rows, "warn": warn, "max_diff": max_diff, "limit": lim})
}

/// 分類別の数: INSP_INFO.classification_count（番号 = kindID）＋ DETECT_INFO の面別の数。
pub fn class_summary(res: &LotRes) -> Value {
    // 数えるのに使う欄だけを読む（全部を読んだ物があればそれ）
    let det = res.dat_cols("DETECT_INFO", &["type", "kindID", "group"]);
    let mut per: BTreeMap<String, BTreeMap<String, i64>> = BTreeMap::new();
    for r in &det.records {
        if det.get(r, "type").map(|t| t.int() != Some(1)).unwrap_or(false) {
            continue;
        }
        let k = py_str(det.get(r, "kindID").unwrap_or(&V::Null));
        *per.entry(k).or_default().entry(py_str(det.get(r, "group").unwrap_or(&V::Null))).or_default() += 1;
    }
    let insp = res.dat("INSP_INFO");
    let cc =
        insp.first().and_then(|r| insp.get(r, "classification_count")).and_then(|v| if let V::L(l) = v { Some(l.clone()) } else { None });
    let mut ids: Vec<String> = per.keys().cloned().collect();
    if let Some(cc) = &cc {
        for (i, v) in cc.iter().enumerate() {
            if v.num().is_some_and(|x| x > 0.0) && !ids.contains(&i.to_string()) {
                ids.push(i.to_string());
            }
        }
    }
    let key = |x: &String| x.trim_start_matches('-').bytes().all(|b| b.is_ascii_digit()) && !x.trim_start_matches('-').is_empty();
    ids.sort_by_key(|x| if key(x) { x.parse::<i64>().unwrap_or(999) } else { 999 });
    let rows: Vec<Value> = ids
        .iter()
        .map(|k| {
            let ki = res.kind_info(Some(&k.parse::<i64>().map(V::I).unwrap_or(V::S(k.clone()))));
            let total = match (&cc, k.parse::<usize>()) {
                (Some(cc), Ok(i)) if k.bytes().all(|b| b.is_ascii_digit()) => cc.get(i).and_then(V::int).filter(|v| *v >= 0),
                _ => None,
            };
            json!({"kind": k, "name": ki.name, "mark": ki.mark, "color": ki.color, "total": total, "sides": per.get(k).cloned().unwrap_or_default()})
        })
        .collect();
    json!({"rows": rows, "sides": res.sides_json()})
}

/// 作業情報の CSV（lot の列がロット名の行）。
pub fn work_info(cfg: &Config, lot_name: &str) -> Value {
    let p = cfg.str("work_info_csv");
    if p.is_empty() {
        return Value::Null;
    }
    let Ok(bytes) = std::fs::read(&p) else { return Value::Null };
    let text = match std::str::from_utf8(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes)) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::SHIFT_JIS.decode(&bytes).0.into_owned(),
    };
    let rows = csv_rows(&text);
    let Some(head) = rows.first() else { return Value::Null };
    for r in &rows[1..] {
        let rec: Map<String, Value> = head.iter().enumerate().map(|(i, h)| (h.clone(), json!(r.get(i).cloned()))).collect();
        if rec.get("lot").and_then(Value::as_str).map(str::trim) == Some(lot_name) {
            return Value::Object(rec);
        }
    }
    Value::Null
}

/// CSV（"…" の中の , と改行・"" を扱う）。
pub fn csv_rows(text: &str) -> Vec<Vec<String>> {
    let (mut rows, mut row, mut cell, mut q) = (vec![], vec![], String::new(), false);
    let mut it = text.chars().peekable();
    while let Some(c) = it.next() {
        match (q, c) {
            (true, '"') if it.peek() == Some(&'"') => {
                cell.push('"');
                it.next();
            }
            (true, '"') => q = false,
            (true, c) => cell.push(c),
            (false, '"') => q = true,
            (false, ',') => row.push(std::mem::take(&mut cell)),
            (false, '\r') => {}
            (false, '\n') => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            (false, c) => cell.push(c),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_helpers() {
        assert!(wild("COND*.xml", "cond01.XML") && !wild("COND*.xml", "Common.xml") && wild("a?c", "abc"));
        assert!(path_match("cond/COND01.xml", "cond/COND*.xml") && path_match("x/cond/Common.xml", "cond/Common.xml"));
        assert_eq!(fmt_num(&V::I(3), None), "3");
        assert_eq!(fmt_num(&V::I(3), Some(0.001)), "0.00");
        assert_eq!(fmt_num(&V::F(2.5), None), "2.50");
        assert_eq!(fmt_val(&V::B(true)), "True");
        assert_eq!(fmt_val(&V::L((0..20).map(V::I).collect())), "0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 …");
        assert_eq!(lot_meta_value("2026_10_25_22_03_53", "time", None), "22:03");
        assert_eq!(lot_meta_value("2026_10_25_22_03_53", "date", Some("mmdd")), "10/25");
        assert_eq!(csv_rows("lot,a\n\"x,1\",\"b\"\"c\"\r\n"), vec![vec!["lot", "a"], vec!["x,1", "b\"c"]]);
    }
}
