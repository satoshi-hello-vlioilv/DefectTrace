//! 検査記録の .dat を、定義（option/InspectDataInfo.xml）に従って読む。形は program/docs/DATA_FORMAT.md。
//!
//! ```text
//! int32 頭の長さ（この欄を含む） / int32 dataVersion（= 定義の structure id） / int32 1 件のバイト数 / byte 名前の長さ + 名前
//! [1 byte の印 + 1 件分] の繰り返し
//! ```
//! 長さの無い String の欄は、決まった長さの 1 件の残りを使う。DateTime（8 バイト）は 2 ビットの Kind＋62 ビットの tick（100ns）で、
//! 保存の仕方が 2 通りある（ToBinary＝UTC 保存・構造体のまま＝現地時刻）。どちらかはファイルごとに、ロットのフォルダ名の時刻に近い方で決める。

use crate::xml;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, OnceLock};

/// 1 つの値。
#[derive(Debug, Clone, PartialEq)]
pub enum V {
    Null,
    I(i64),
    U(u64),
    F(f64),
    B(bool),
    S(String),
    /// DateTime の生の 8 バイト（読み終えたら S に直す）
    T(u64),
    L(Vec<V>),
}

impl V {
    /// 値 1 つのメモリの大きさ（文字・並びの中身も）。
    pub fn heap(&self) -> usize {
        std::mem::size_of::<V>()
            + match self {
                V::S(s) => s.capacity(),
                V::L(l) => l.iter().map(V::heap).sum(),
                _ => 0,
            }
    }

    pub fn num(&self) -> Option<f64> {
        match self {
            V::I(i) => Some(*i as f64),
            V::U(u) => Some(*u as f64),
            V::F(f) => Some(*f),
            V::B(b) => Some(*b as i64 as f64),
            V::S(s) => s.trim().parse().ok(),
            _ => None,
        }
    }
    pub fn int(&self) -> Option<i64> {
        match self {
            V::I(i) => Some(*i),
            V::U(u) => i64::try_from(*u).ok(),
            V::B(b) => Some(*b as i64),
            _ => None,
        }
    }
    pub fn str(&self) -> Option<&str> {
        match self {
            V::S(s) => Some(s),
            _ => None,
        }
    }
    pub fn to_json(&self) -> Value {
        match self {
            V::Null | V::T(_) => Value::Null,
            V::I(i) => json!(i),
            V::U(u) => json!(u),
            V::F(f) => serde_json::Number::from_f64(*f).map(Value::Number).unwrap_or(Value::Null),
            V::B(b) => json!(b),
            V::S(s) => json!(s),
            V::L(l) => Value::Array(l.iter().map(V::to_json).collect()),
        }
    }
}

/// 1 件（欄の並びは定義の順。Byte[] の欄は持たない）。
#[derive(Debug, Clone, Default)]
pub struct Rec {
    pub vals: Vec<V>,
    pub flag: u8,
}

/// 欄の定義。
#[derive(Debug, Clone)]
pub struct Field {
    pub name: String,
    pub typ: String,
    pub length: usize,
    pub cnt: usize,
    pub label: String,
}

#[derive(Debug)]
struct Structure {
    items: Vec<Item>,
}

#[derive(Debug)]
enum Item {
    Link(String),
    Field(Field),
}

/// 定義（InspectDataInfo.xml）。
#[derive(Debug, Default)]
pub struct Defs {
    structs: HashMap<String, Structure>,
    default_ver: HashMap<String, String>,
}

impl Defs {
    pub fn parse(data: &[u8]) -> Result<Defs, String> {
        let text = xml::decode(data);
        let opt = roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() };
        let doc = roxmltree::Document::parse_with_options(&text, opt).map_err(|e| e.to_string())?;
        let root = doc.root_element();
        let mut d = Defs::default();
        if let Some(defs) = root.children().find(|c| c.has_tag_name("definitions")) {
            for s in defs.children().filter(|c| c.has_tag_name("structure")) {
                let mut items = vec![];
                let mut last: Option<String> = None;
                for c in s.children() {
                    if c.is_comment() {
                        last = Some(xml::clean_label(c.text().unwrap_or("")));
                        continue;
                    }
                    if !c.is_element() {
                        continue;
                    }
                    let n = |k: &str| c.attribute(k).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
                    if c.has_tag_name("link") {
                        items.push(Item::Link(c.attribute("id").unwrap_or("").to_string()));
                    } else if c.has_tag_name("field") {
                        items.push(Item::Field(Field {
                            name: c.attribute("name").unwrap_or("").to_string(),
                            typ: c.attribute("type").unwrap_or("").to_string(),
                            length: n("length"),
                            cnt: if n("item_cnt") == 0 { 1 } else { n("item_cnt") },
                            label: last.clone().unwrap_or_default(),
                        }));
                    }
                    last = None;
                }
                d.structs.insert(s.attribute("id").unwrap_or("").to_string(), Structure { items });
            }
        }
        if let Some(sd) = root.children().find(|c| c.has_tag_name("system_default")) {
            for c in sd.children().filter(|c| c.is_element()) {
                if let Some(v) = c.attribute("dataVersion").filter(|v| !v.is_empty()) {
                    d.default_ver.insert(c.tag_name().name().to_string(), v.to_string());
                }
            }
        }
        Ok(d)
    }

    /// 構造の欄（link をたどって展開。回り込みは 1 度だけ）。
    pub fn fields(&self, sid: &str) -> Vec<Field> {
        let mut seen = std::collections::HashSet::new();
        self.fields_of(sid, &mut seen)
    }

    fn fields_of(&self, sid: &str, seen: &mut std::collections::HashSet<String>) -> Vec<Field> {
        if seen.contains(sid) {
            return vec![];
        }
        let Some(s) = self.structs.get(sid) else { return vec![] };
        seen.insert(sid.to_string());
        let mut out = vec![];
        for it in &s.items {
            match it {
                Item::Link(id) => out.extend(self.fields_of(id, seen)),
                Item::Field(f) => out.push(f.clone()),
            }
        }
        out
    }
}

/// 定義を読む（中身で覚える）。
pub fn load_defs(path: &Path) -> Result<Arc<Defs>, String> {
    // 中身で覚える: 定義の XML はロットごとにあるが、中身はほとんど同じ（設備・版が同じなら同じ）。56 KB の Shift_JIS を
    // 読み解くのに 1 ロット約 2.5 ms かかっていたので、同じ中身は 1 度だけ読み解く。覚えの重さは中身の大きさ × 4
    use std::hash::{Hash, Hasher};
    static CACHE: OnceLock<crate::cache::Lru<(usize, u64), Arc<Defs>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| crate::cache::Lru::new(32 << 20));
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut h);
    let k = (bytes.len(), h.finish());
    if let Some(d) = cache.get(&k) {
        return Ok(d);
    }
    let d = Arc::new(Defs::parse(&bytes)?);
    Ok(cache.insert(k, d, bytes.len() * 4))
}

fn prim(t: &str) -> Option<usize> {
    Some(match t {
        "System.Int32" | "System.UInt32" | "System.Single" => 4,
        "System.Int64" | "System.UInt64" | "System.Double" | "System.DateTime" => 8,
        "System.Int16" | "System.UInt16" => 2,
        "System.Byte" | "System.SByte" | "System.Boolean" => 1,
        _ => return None,
    })
}

fn fsize(f: &Field) -> Option<usize> {
    if f.typ == "System.String" || f.typ == "System.Byte[]" {
        return (f.length > 0).then_some(f.length * f.cnt);
    }
    prim(&f.typ).map(|s| s * f.cnt)
}

/// 欄ごとの大きさ。長さの分からない欄が 1 つだけなら、1 件のバイト数の残りを当てる。
pub fn resolve_sizes(fields: &[Field], rec_size: usize) -> Option<Vec<usize>> {
    let sizes: Vec<Option<usize>> = fields.iter().map(fsize).collect();
    let unknown: Vec<usize> = sizes.iter().enumerate().filter(|(_, s)| s.is_none()).map(|(i, _)| i).collect();
    let known: usize = sizes.iter().flatten().sum();
    if unknown.len() == 1 && rec_size > 0 && rec_size >= known {
        let mut out: Vec<usize> = sizes.iter().map(|s| s.unwrap_or(0)).collect();
        out[unknown[0]] = rec_size - known;
        return Some(out);
    }
    if !unknown.is_empty() {
        return None;
    }
    Some(sizes.into_iter().flatten().collect())
}

/// 文字（NUL まで。UTF-8 で読めなければ Shift_JIS）。
pub fn dec_str(b: &[u8]) -> String {
    let b = &b[..b.iter().position(|&c| c == 0).unwrap_or(b.len())];
    match std::str::from_utf8(b) {
        Ok(s) => s.trim().to_string(),
        Err(_) => encoding_rs::SHIFT_JIS.decode(b).0.trim().to_string(),
    }
}

fn read_prim(t: &str, d: &[u8]) -> V {
    let a = |n: usize| -> [u8; 8] {
        let mut x = [0u8; 8];
        x[..n].copy_from_slice(&d[..n]);
        x
    };
    match t {
        "System.Int32" => V::I(i32::from_le_bytes(a(4)[..4].try_into().unwrap()) as i64),
        "System.UInt32" => V::I(u32::from_le_bytes(a(4)[..4].try_into().unwrap()) as i64),
        "System.Int64" => V::I(i64::from_le_bytes(a(8))),
        "System.UInt64" => {
            let u = u64::from_le_bytes(a(8));
            i64::try_from(u).map(V::I).unwrap_or(V::U(u))
        }
        "System.Int16" => V::I(i16::from_le_bytes(a(2)[..2].try_into().unwrap()) as i64),
        "System.UInt16" => V::I(u16::from_le_bytes(a(2)[..2].try_into().unwrap()) as i64),
        "System.Byte" => V::I(d[0] as i64),
        "System.SByte" => V::I(d[0] as i8 as i64),
        "System.Double" => V::F(f64::from_le_bytes(a(8))),
        "System.Single" => V::F(f32::from_le_bytes(a(4)[..4].try_into().unwrap()) as f64),
        "System.Boolean" => V::B(d[0] != 0),
        "System.DateTime" => V::T(u64::from_le_bytes(a(8))),
        _ => V::Null,
    }
}

/// 1 件を読む。want があれば、その欄（true の物）だけを読み、ほかは Null（数えるだけのとき: 軽く・速く）。
fn parse_rec(data: &[u8], mut off: usize, fields: &[Field], sizes: &[usize], want: Option<&[bool]>) -> Vec<V> {
    let mut out = Vec::with_capacity(fields.len());
    for (i, (f, &sz)) in fields.iter().zip(sizes).enumerate() {
        if f.typ == "System.Byte[]" {
            off += sz;
            continue;
        }
        if want.is_some_and(|w| !w[i]) {
            out.push(V::Null);
            off += sz;
            continue;
        }
        let v = if f.typ == "System.String" {
            let l = sz / f.cnt.max(1);
            let vals: Vec<V> = (0..f.cnt).map(|i| V::S(dec_str(&data[off + i * l..off + (i + 1) * l]))).collect();
            one_or_list(vals)
        } else {
            let s = prim(&f.typ).unwrap_or(0);
            let vals: Vec<V> = (0..f.cnt).map(|i| read_prim(&f.typ, &data[off + i * s..])).collect();
            one_or_list(vals)
        };
        out.push(v);
        off += sz;
    }
    out
}

fn one_or_list(mut v: Vec<V>) -> V {
    if v.len() == 1 {
        v.pop().unwrap()
    } else {
        V::L(v)
    }
}

// ------------------------------------------------------------------ DateTime
pub type DateTime = chrono::NaiveDateTime;

fn epoch() -> DateTime {
    chrono::NaiveDate::from_ymd_opt(1, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap()
}

pub fn ticks_kind(v: u64) -> (u64, u64) {
    ((v >> 62) & 3, v & 0x3FFF_FFFF_FFFF_FFFF)
}

/// 8 バイト → 日時。binary＝Kind が Local・Utc の値は UTC なので時差を足す。internal＝そのまま。
pub fn ticks_to_dt(v: u64, binary: bool, utc_offset: chrono::Duration) -> Option<DateTime> {
    let (kind, t) = ticks_kind(v);
    if t == 0 {
        return None;
    }
    let d = epoch().checked_add_signed(chrono::Duration::microseconds((t / 10) as i64))?;
    if d.and_utc().timestamp() > 253_402_300_799 {
        return None; // Python の datetime は 9999 年まで
    }
    Some(if (kind == 1 || kind == 2) && binary { d.checked_add_signed(utc_offset)? } else { d })
}

pub fn dt_text(d: &DateTime) -> String {
    d.format("%Y/%m/%d %H:%M:%S").to_string()
}

fn dt_items(r: &[V]) -> impl Iterator<Item = u64> + '_ {
    r.iter().flat_map(|v| match v {
        V::T(t) => vec![*t],
        V::L(l) => l.iter().filter_map(|x| if let V::T(t) = x { Some(*t) } else { None }).collect(),
        _ => vec![],
    })
}

/// UTC 保存（binary）か現地時刻保存（internal）か: 先頭 50 件の Kind=Local/Utc の値が、ref に近い方。
fn decide_mode(records: &[Rec], refdt: Option<DateTime>, off: chrono::Duration) -> (bool, usize) {
    let Some(r) = refdt else { return (true, 0) };
    let (mut db, mut di, mut n) = (0.0f64, 0.0f64, 0usize);
    for rec in records.iter().take(50) {
        for v in dt_items(&rec.vals) {
            let (kind, _) = ticks_kind(v);
            if kind != 1 && kind != 2 {
                continue;
            }
            let (Some(a), Some(b)) = (ticks_to_dt(v, true, off), ticks_to_dt(v, false, off)) else { continue };
            db += ((a - r).num_microseconds().unwrap_or(i64::MAX) as f64 / 1e6).abs();
            di += ((b - r).num_microseconds().unwrap_or(i64::MAX) as f64 / 1e6).abs();
            n += 1;
        }
    }
    if n == 0 {
        return (true, 0);
    }
    (db <= di, n)
}

fn finish(records: &mut [Rec], binary: bool, off: chrono::Duration) {
    let fix = |t: u64| V::S(ticks_to_dt(t, binary, off).map(|d| dt_text(&d)).unwrap_or_default());
    for r in records {
        for v in r.vals.iter_mut() {
            match v {
                V::T(t) => *v = fix(*t),
                V::L(l) if matches!(l.first(), Some(V::T(_))) => {
                    for x in l.iter_mut() {
                        if let V::T(t) = x {
                            *x = fix(*t);
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// 読んだ .dat。
#[derive(Debug, Default)]
pub struct Dat {
    pub name: String,
    pub version: Option<String>,
    pub fields: Vec<Field>,
    pub records: Vec<Rec>,
    pub layout: Option<Value>,
    pub error: Option<String>,
    /// "binary" / "internal"（日時の値があったときだけ）
    pub dt_mode: Option<&'static str>,
    /// 欄の名前 → 位置（Byte[] を除いた並び）
    index: HashMap<String, usize>,
    /// メモリの上のだいたいの大きさ（バイト。覚えの重さ）
    pub bytes: usize,
}

impl Dat {
    pub fn empty(name: &str, error: &str) -> Dat {
        Dat { name: name.into(), error: Some(error.into()), ..Default::default() }
    }

    /// 値の欄（Byte[] を除く）。
    pub fn value_fields(&self) -> impl Iterator<Item = &Field> {
        self.fields.iter().filter(|f| f.typ != "System.Byte[]")
    }

    pub fn col(&self, name: &str) -> Option<usize> {
        self.index.get(name).copied()
    }

    /// 1 件の値（名前で）。
    pub fn get<'a>(&self, r: &'a Rec, name: &str) -> Option<&'a V> {
        self.col(name).and_then(|i| r.vals.get(i))
    }

    pub fn first(&self) -> Option<&Rec> {
        self.records.first()
    }

    /// 1 件を JSON に（欄の名前 → 値・_flag）。
    pub fn rec_json(&self, r: &Rec) -> Value {
        let mut m = Map::new();
        for (f, v) in self.value_fields().zip(&r.vals) {
            m.insert(f.name.clone(), v.to_json());
        }
        m.insert("_flag".into(), json!(r.flag));
        Value::Object(m)
    }
}

/// .dat の件数（頭の 12 バイトとファイルの大きさから。中身は読まない）。読めなければ None。
pub fn count_records(path: &Path) -> Option<usize> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len() as usize;
    let mut h = [0u8; 12];
    f.read_exact(&mut h).ok()?;
    let (hl, rs) = (i32::from_le_bytes(h[0..4].try_into().ok()?), i32::from_le_bytes(h[8..12].try_into().ok()?));
    (hl >= 0 && rs >= 0).then(|| len.saturating_sub(hl as usize) / (rs as usize + 1))
}

/// .dat を読む。limit 件まで。refdt はロットのフォルダ名の時刻（日時の保存の仕方を決める）。
pub fn read_dat(path: &Path, defs: &Defs, name: &str, limit: usize, refdt: Option<DateTime>, utc_offset: chrono::Duration) -> Dat {
    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(e) => return Dat::empty(name, &format!("読込エラー: {e}")),
    };
    parse_dat(&data, defs, name, limit, refdt, utc_offset)
}

pub fn parse_dat(data: &[u8], defs: &Defs, name: &str, limit: usize, refdt: Option<DateTime>, utc_offset: chrono::Duration) -> Dat {
    parse_dat_cols(data, defs, name, limit, refdt, utc_offset, None)
}

/// 欄を選んで読む（cols の欄だけ。ほかは Null。欄の並び・名前は全部の時と同じ）。
pub fn read_dat_cols(path: &Path, defs: &Defs, name: &str, cols: &[&str], refdt: Option<DateTime>, utc_offset: chrono::Duration) -> Dat {
    match std::fs::read(path) {
        Ok(d) => parse_dat_cols(&d, defs, name, usize::MAX, refdt, utc_offset, Some(cols)),
        Err(e) => Dat::empty(name, &format!("読込エラー: {e}")),
    }
}

fn parse_dat_cols(
    data: &[u8],
    defs: &Defs,
    name: &str,
    limit: usize,
    refdt: Option<DateTime>,
    utc_offset: chrono::Duration,
    cols: Option<&[&str]>,
) -> Dat {
    let mut res = Dat { name: name.into(), ..Default::default() };
    if data.len() < 13 {
        res.error = Some("読込エラー: 頭が短すぎます".into());
        return res;
    }
    let i32_at = |o: usize| i32::from_le_bytes(data[o..o + 4].try_into().unwrap());
    let (hl, ver, rs) = (i32_at(0), i32_at(4).to_string(), i32_at(8));
    let n = data[12] as usize;
    let hname = String::from_utf8_lossy(&data[13..(13 + n).min(data.len())]).into_owned();
    res.version = Some(ver.clone());
    let sid = if defs.structs.contains_key(&ver) { Some(ver.clone()) } else { defs.default_ver.get(name).cloned() };
    let fields = sid.as_deref().map(|s| defs.fields(s)).unwrap_or_default();
    let sizes = if fields.is_empty() || rs < 0 { None } else { resolve_sizes(&fields, rs as usize) };
    res.fields = fields.clone();
    res.index = res.value_fields().enumerate().map(|(i, f)| (f.name.clone(), i)).collect();
    if fields.is_empty() {
        res.error = Some(format!("定義が見つかりません (version={ver})"));
        return res;
    }
    let total: usize = sizes.as_ref().map(|s| s.iter().sum()).unwrap_or(0);
    match &sizes {
        Some(s) if total as i64 == rs as i64 => {
            if hl < 0 {
                res.error = Some("読込エラー: 頭の長さが負です".into());
                return res;
            }
            let (hl, rs) = (hl as usize, rs as usize);
            let step = rs + 1;
            let count = data.len().saturating_sub(hl) / step;
            let rest = data.len().saturating_sub(hl) % step;
            res.layout = Some(json!({"header": hl, "record_size": rs, "count": count, "name": hname, "rest": rest}));
            let take = count.min(limit);
            let want: Option<Vec<bool>> = cols.map(|c| fields.iter().map(|f| c.contains(&f.name.as_str())).collect());
            res.records.reserve(take);
            for i in 0..take {
                let off = hl + i * step;
                res.records.push(Rec { vals: parse_rec(data, off + 1, &fields, s, want.as_deref()), flag: data[off] });
            }
            let (binary, n) = decide_mode(&res.records, refdt, utc_offset);
            finish(&mut res.records, binary, utc_offset);
            res.dt_mode = (n > 0).then_some(if binary { "binary" } else { "internal" });
            res.bytes = res.records.iter().map(|r| std::mem::size_of::<Rec>() + r.vals.iter().map(V::heap).sum::<usize>()).sum();
        }
        _ => {
            let def = sizes.as_ref().map(|s| s.iter().sum::<usize>()).unwrap_or(0);
            res.error = Some(format!("レコード長が定義と一致しません (定義={def}, ファイル={rs})"));
        }
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFS: &str = r#"<?xml version="1.0" encoding="utf-8"?><r><definitions>
      <structure id="9"><!-- 連番 --><field name="seq" type="System.UInt32"/></structure>
      <structure id="1" name="A"><link id="9"/><!-- 値 comment 2 --><field name="v" type="System.Double"/>
        <field name="pad" type="System.Byte[]" length="2"/><field name="d" type="System.DateTime"/>
        <field name="s" type="System.String"/></structure></definitions>
      <system_default><A dataVersion="1"/></system_default></r>"#;

    fn file(rs: i32, recs: &[(u32, f64, u64, &str)]) -> Vec<u8> {
        let mut b = vec![];
        b.extend(14i32.to_le_bytes());
        b.extend(1i32.to_le_bytes());
        b.extend(rs.to_le_bytes());
        b.push(1);
        b.push(b'A');
        for (seq, v, d, s) in recs {
            b.push(1);
            b.extend(seq.to_le_bytes());
            b.extend(v.to_le_bytes());
            b.extend([0xAB, 0xAB]);
            b.extend(d.to_le_bytes());
            let mut sb = s.as_bytes().to_vec();
            sb.resize(rs as usize - 22, 0);
            b.extend(sb);
        }
        b
    }

    #[test]
    fn reads_links_variable_strings_and_both_datetime_modes() {
        let defs = Defs::parse(DEFS.as_bytes()).unwrap();
        let f = defs.fields("1");
        assert_eq!(f.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["seq", "v", "pad", "d", "s"]);
        assert_eq!(f[1].label, "値");
        let refdt = chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap().and_hms_opt(22, 0, 0).unwrap();
        let off = chrono::Duration::hours(9);
        // 現地 22:00:10 を UTC で（ToBinary）保存: 13:00:10 + Kind=Local
        let t = |h: u32| {
            let d = chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap().and_hms_opt(h, 0, 10).unwrap();
            (2u64 << 62) | ((d - epoch()).num_microseconds().unwrap() as u64 * 10)
        };
        let d = parse_dat(&file(30, &[(7, 1.5, t(13), "あい")]), &defs, "A", 100, Some(refdt), off);
        assert_eq!(d.error, None);
        assert_eq!(d.dt_mode, Some("binary"));
        let r = &d.records[0];
        assert_eq!(d.get(r, "d"), Some(&V::S("2026/10/25 22:00:10".into())));
        assert_eq!(d.get(r, "s"), Some(&V::S("あい".into())), "長さの無い文字は残りのバイト");
        assert_eq!(d.rec_json(r)["seq"], 7);
        assert!(d.rec_json(r).get("pad").is_none(), "Byte[] は持たない");
        // 現地時刻のまま保存
        let d = parse_dat(&file(30, &[(1, 0.0, t(22), "")]), &defs, "A", 100, Some(refdt), off);
        assert_eq!((d.dt_mode, d.get(&d.records[0], "d").cloned()), (Some("internal"), Some(V::S("2026/10/25 22:00:10".into()))));
        let bad = parse_dat(&file(21, &[]), &defs, "A", 100, None, off);
        assert!(bad.error.unwrap().contains("レコード長"));
    }
}
