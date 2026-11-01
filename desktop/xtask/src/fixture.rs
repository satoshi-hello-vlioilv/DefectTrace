//! 試験のロットを作る（検査計の共有フォルダを真似る。毎回同じ物ができる）。
//!
//! ```text
//! cargo xtask fixture <作る場所>                     正解データ（golden）用の小さな木（3 ロット）
//! cargo xtask fixture <作る場所> --bench N W H       速さを測る大きなロット（N 個の CAB × 100 枚、W×H の BMP）
//! cargo xtask fixture <作る場所> --dl2 <名前> [--eq <設備>] [--max-status <0|1>]   画像なしのロットを 1 つ
//! ```
//!
//! 作る木（設備 > 年 > 年月 > 日 > ロット。<作る場所>/LS3/2026/2026_10/2026_10_25/2026_10_25_22_03_53 など）:
//!   - LS3 のロット: img/0000.cab …（MSZIP の CAB・IMAGE_LINK）と fm_img/0000/*.bmp（フォルダ・FM_IMAGE_LINK）
//! ```text
//! 表と裏で幅方向位置が近い欠陥（転写候補）、等間隔の欠陥の列（ピッチ候補）、多量（type=2・kindID=1100）を含む
//! ```
//!   - DL2 のロット: 画像なし。表裏の group が LS3 と逆。COND*.xml は wavedata/cond の下だけにある
//!   - フォルダ名がロットの形でないフォルダ（一覧に出るがロットではない）
//!
//! .dat の形と DateTime の保存方式（UTC 保存・現地時刻保存）は program/docs/DATA_FORMAT.md。
//! 正解データ（desktop/tests/golden.json）は、版 4.8.0 までの Python の作り（fixture_lot.py）が作った木に版 3.8 が返した答えなので、
//! 乱数・時刻・数の丸めは Python とビットまで同じに作る（pyrand.rs）。CAB の圧縮のバイトは違ってよい（展開した中身が同じ）。

use crate::pyrand::{floordiv, timedelta_seconds_us, true_div, Random};
use chrono::{NaiveDate, NaiveDateTime};
use flate2::{write::DeflateEncoder, Compression};
use std::io::Write;
use std::path::{Path, PathBuf};

// ------------------------------------------------------------------ 定義（InspectDataInfo.xml）
/// 欄: (注釈, 名前, 型, 長さ, 個数)
type Field = (&'static str, &'static str, &'static str, usize, usize);

const DETECT_INFO: &[Field] = &[
    ("欠陥No", "detectNo", "System.Int32", 0, 1),
    ("記録の種類", "type", "System.Int32", 0, 1),
    ("分類", "kindID", "System.Int32", 0, 1),
    ("面", "group", "System.Int32", 0, 1),
    ("カメラ", "camera", "System.Int32", 0, 1),
    ("X座標(mm)", "x_mm", "System.Double", 0, 1),
    ("基準X", "base_x", "System.Double", 0, 1),
    ("X終点", "x_end", "System.Double", 0, 1),
    ("Y座標(mm) for length", "y_mm", "System.Double", 0, 1),
    ("幅", "width_mm", "System.Double", 0, 1),
    ("長さ", "length_mm", "System.Double", 0, 1),
    ("面積", "area_mm", "System.Double", 0, 1),
    ("ピークレベル明", "peek_level1", "System.Int16", 0, 1),
    ("ピークレベル暗", "peek_level2", "System.Int16", 0, 1),
    ("平均レベル暗", "ave_level2", "System.Single", 0, 1),
    ("ライン速度", "line_speed", "System.Single", 0, 1),
    ("発生日時", "datetime", "System.DateTime", 0, 1),
    ("画像ID", "image_id", "System.Int64", 0, 1),
    ("予備", "reserve", "System.Byte[]", 6, 1),
];
const LINK: &[Field] = &[
    ("画像ファイル番号", "image_fileno", "System.Int32", 0, 1),
    ("欠陥レコード番号", "detect_recno", "System.Int32", 0, 1),
    ("画像ID", "image_id", "System.Int64", 0, 1),
];
const INSP_INFO: &[Field] = &[
    ("検査開始日時", "start_time", "System.DateTime", 0, 1),
    ("検査終了日時", "end_time", "System.DateTime", 0, 1),
    ("検査長 comment 1", "insp_end_y", "System.Double", 0, 1),
    ("欠陥総数", "detect_total_cnt", "System.Int32", 0, 1),
    ("画像総数", "image_total_cnt", "System.Int32", 0, 1),
    ("検査範囲始点", "insp_area_st", "System.Double", 0, 1),
    ("検査範囲終点", "insp_area_ed", "System.Double", 0, 1),
    ("分類別件数", "classification_count", "System.Int32", 0, 8),
    ("多量集計数", "error_count", "System.Int32", 0, 1),
    ("欠陥数上限", "detect_max_status", "System.Byte", 0, 1),
    ("検査状態", "insp_state", "System.Int16", 0, 1),
    ("良否", "ok", "System.Boolean", 0, 1),
    ("品名", "product", "System.String", 16, 1),
    ("備考", "note", "System.String", 0, 1), // 長さの無い文字列 = 残りのバイト
];
const STAT_INFO: &[Field] = &[("時刻", "time", "System.DateTime", 0, 1), ("件数", "count", "System.UInt16", 0, 1)];
const SLIT_MASK_STAT: &[Field] = &[("設定日時", "date_time", "System.DateTime", 0, 1), ("マスク", "mask", "System.UInt32", 0, 2)];

/// 構造: (名前, 版〈id〉, 欄)。並びは定義の XML に書く順
const STRUCTS: &[(&str, &str, &[Field])] = &[
    ("DETECT_INFO", "100", DETECT_INFO),
    ("IMAGE_LINK", "200", LINK),
    ("FM_IMAGE_LINK", "210", LINK),
    ("INSP_INFO", "300", INSP_INFO),
    ("STAT_INFO", "400", STAT_INFO),
    ("SLIT_MASK_STAT", "500", SLIT_MASK_STAT),
];
/// 共通の頭（link で取り込む）
const COMMON: (&str, &[Field]) = ("900", &[("連番", "seq", "System.UInt32", 0, 1)]);
const LINKED: &[&str] = &["STAT_INFO"];

fn struct_of(name: &str) -> (&'static str, &'static [Field]) {
    STRUCTS.iter().find(|s| s.0 == name).map(|s| (s.1, s.2)).unwrap_or_else(|| panic!("構造が無い: {name}"))
}

fn fields_of(name: &str) -> Vec<Field> {
    let mut f = if LINKED.contains(&name) { COMMON.1.to_vec() } else { vec![] };
    f.extend_from_slice(struct_of(name).1);
    f
}

/// 型の 1 個ぶんのバイト数（文字・バイト列は長さで決まる）
fn type_size(typ: &str) -> usize {
    match typ {
        "System.Int64" | "System.UInt64" | "System.Double" | "System.DateTime" => 8,
        "System.Int32" | "System.UInt32" | "System.Single" => 4,
        "System.Int16" | "System.UInt16" => 2,
        "System.Byte" | "System.SByte" | "System.Boolean" => 1,
        t => panic!("知らない型: {t}"),
    }
}

fn fixed_size(fields: &[Field]) -> usize {
    fields
        .iter()
        .map(|&(_, _, typ, len, cnt)| if matches!(typ, "System.String" | "System.Byte[]") { len * cnt } else { type_size(typ) * cnt })
        .sum()
}

pub fn defs_xml() -> String {
    let mut out = vec![r#"<?xml version="1.0" encoding="shift_jis"?>"#.to_string(), "<InspectDataInfo>".into(), " <definitions>".into()];
    let all = std::iter::once(("COMMON", COMMON.0, COMMON.1)).chain(STRUCTS.iter().copied());
    for (name, sid, fields) in all {
        out.push(format!(r#"  <structure id="{sid}" name="{name}">"#));
        if LINKED.contains(&name) {
            out.push(format!(r#"   <link id="{}"/>"#, COMMON.0));
        }
        for &(label, fname, typ, len, cnt) in fields {
            out.push(format!("   <!-- {label} -->"));
            let mut attrs = format!(r#"name="{fname}" type="{typ}""#);
            if len > 0 {
                attrs += &format!(r#" length="{len}""#);
            }
            if cnt > 1 {
                attrs += &format!(r#" item_cnt="{cnt}""#);
            }
            out.push(format!("   <field {attrs}/>"));
        }
        out.push("  </structure>".into());
    }
    out.push(" </definitions>".into());
    out.push(" <system_default>".into());
    for (name, sid, _) in STRUCTS {
        out.push(format!(r#"  <{name} dataVersion="{sid}"/>"#));
    }
    out.push(" </system_default>".into());
    out.push("</InspectDataInfo>".into());
    out.join("\n") + "\n"
}

// ------------------------------------------------------------------ 値と .dat
/// 1 欄の値
#[derive(Clone, Debug)]
pub enum Val {
    I(i64),
    U(u64),
    F(f64),
    B(bool),
    S(String),
    L(Vec<i64>),
}

/// 1 件（欄の名前と値。無い欄は 0）
pub type Rec = Vec<(&'static str, Val)>;

fn get<'a>(r: &'a Rec, name: &str) -> Option<&'a Val> {
    r.iter().find(|(k, _)| *k == name).map(|(_, v)| v)
}

fn pack(out: &mut Vec<u8>, typ: &str, v: &Val) {
    let int = |v: &Val| match v {
        Val::I(i) => *i,
        Val::U(u) => *u as i64,
        Val::B(b) => *b as i64,
        Val::F(f) => *f as i64,
        _ => 0,
    };
    let float = |v: &Val| match v {
        Val::F(f) => *f,
        Val::I(i) => *i as f64,
        _ => 0.0,
    };
    match typ {
        "System.Int32" => out.extend((int(v) as i32).to_le_bytes()),
        "System.UInt32" => out.extend((int(v) as u32).to_le_bytes()),
        "System.Int64" => out.extend(int(v).to_le_bytes()),
        "System.UInt64" | "System.DateTime" => out.extend(
            match v {
                Val::U(u) => *u,
                other => int(other) as u64,
            }
            .to_le_bytes(),
        ),
        "System.Int16" => out.extend((int(v) as i16).to_le_bytes()),
        "System.UInt16" => out.extend((int(v) as u16).to_le_bytes()),
        "System.Byte" => out.push(int(v) as u8),
        "System.SByte" => out.push(int(v) as i8 as u8),
        "System.Boolean" => out.push((int(v) != 0) as u8),
        "System.Double" => out.extend(float(v).to_le_bytes()),
        "System.Single" => out.extend((float(v) as f32).to_le_bytes()),
        t => panic!("知らない型: {t}"),
    }
}

/// 日本語の字を検査計の字（Shift_JIS）に
fn sjis(s: &str) -> Vec<u8> {
    let (b, _, bad) = encoding_rs::SHIFT_JIS.encode(s);
    assert!(!bad, "Shift_JIS に無い字: {s}");
    b.into_owned()
}

/// .dat を書く: 頭（頭の長さ・版・1 件のバイト数・名前）＋ 件数 ×（印 1 バイト ＋ 1 件）
fn write_dat(path: &Path, name: &str, records: &[Rec], rec_size: Option<usize>) {
    let fields = fields_of(name);
    let mut parts = vec![];
    for r in records {
        let mut b = vec![];
        for &(_, fname, typ, len, cnt) in &fields {
            let v = get(r, fname);
            match typ {
                "System.String" => {
                    let l = match rec_size {
                        Some(rs) if len == 0 => rs - fixed_size(&fields),
                        _ => len,
                    };
                    let mut raw = match v {
                        Some(Val::S(s)) => sjis(s),
                        _ => vec![],
                    };
                    raw.truncate(l);
                    raw.resize(l, 0);
                    b.extend(raw);
                }
                "System.Byte[]" => b.extend(std::iter::repeat_n(0xAB, len)),
                _ => match v {
                    Some(Val::L(l)) => l.iter().for_each(|x| pack(&mut b, typ, &Val::I(*x))),
                    Some(x) => (0..cnt).for_each(|_| pack(&mut b, typ, x)),
                    None => (0..cnt).for_each(|_| pack(&mut b, typ, &Val::I(0))),
                },
            }
        }
        parts.push(b);
    }
    let rs = rec_size.unwrap_or_else(|| parts.first().map(Vec::len).unwrap_or_else(|| fixed_size(&fields)));
    let mut out = vec![];
    out.extend((13 + name.len() as i32).to_le_bytes());
    out.extend(struct_of(name).0.parse::<i32>().unwrap().to_le_bytes());
    out.extend((rs as i32).to_le_bytes());
    out.push(name.len() as u8);
    out.extend(name.as_bytes());
    for p in parts {
        out.push(1);
        out.extend(p);
    }
    std::fs::write(path, out).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
}

// ------------------------------------------------------------------ 時刻（.NET の DateTime の 8 バイト）
const UTC_OFFSET_US: i64 = 9 * 3600 * 1_000_000;

/// 時刻（マイクロ秒の整数。Python の datetime と同じ細かさ）
#[derive(Clone, Copy)]
pub struct Time(i64);

impl Time {
    fn parse(name: &str) -> Time {
        let d = NaiveDateTime::parse_from_str(name, "%Y_%m_%d_%H_%M_%S").unwrap_or_else(|e| panic!("ロットの名前 {name}: {e}"));
        let epoch = NaiveDate::from_ymd_opt(1, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap();
        Time((d - epoch).num_microseconds().unwrap())
    }
    fn plus_seconds(self, s: f64) -> Time {
        Time(self.0 + timedelta_seconds_us(s))
    }
    fn plus_minutes(self, m: i64) -> Time {
        Time(self.0 + m * 60_000_000)
    }
}

/// DateTime の 8 バイト（Kind を上の 2 ビットに）。utc=True は ToBinary の形（Kind=Local/Utc の値を UTC で持つ）
fn ticks(d: Time, kind: u64, utc: bool) -> Val {
    let us = if utc && (kind == 1 || kind == 2) { d.0 - UTC_OFFSET_US } else { d.0 };
    // Python: int((d - EPOCH).total_seconds() * 10_000_000)（秒を小数にしてから掛ける。丸めも同じに）
    let t = (true_div(us, 1_000_000) * 10_000_000.0) as u64;
    Val::U((kind << 62) | t)
}

// ------------------------------------------------------------------ XML（条件の定義）
fn cond_xml(kinds: &[(&str, &str, &str)], comments: &[&str]) -> Vec<u8> {
    let mut rows = vec![
        r#"<?xml version="1.0" encoding="Shift_JIS"?>"#.to_string(),
        "<condition>".into(),
        r#"  <header><cond_name value="条件A-01"/></header>"#.into(),
        "  <target_conditions><target><roll_info><comments>".into(),
    ];
    rows.extend(comments.iter().map(|c| format!(r#"    <comment value="{c}"/>"#)));
    rows.push("  </comments></roll_info></target></target_conditions>".into());
    rows.push("  <classification_conditions>".into());
    for (name, mark, color) in kinds {
        rows.push(format!(
            r#"    <classification_condition><name value="{name}"/><map_mark value="{mark}"/><mark_color value="{color}"/></classification_condition>"#
        ));
    }
    rows.push("  </classification_conditions>".into());
    rows.push("</condition>".into());
    sjis(&(rows.join("\n") + "\n"))
}

fn common_xml(groups: &[(&str, &str)]) -> Vec<u8> {
    let mut rows = vec![r#"<?xml version="1.0" encoding="shift_jis"?>"#.to_string(), "<condition>".into(), "  <group_conditions>".into()];
    rows.extend(groups.iter().map(|(n, c)| format!(r#"    <group><disp_name value="{n}"/><disp_color value="{c}"/></group>"#)));
    rows.push("  </group_conditions>".into());
    rows.push("</condition>".into());
    sjis(&(rows.join("\n") + "\n"))
}

fn system_xml(groups: &[(&str, &[(u32, u32)])]) -> String {
    let mut rows = vec![r#"<?xml version="1.0" encoding="utf-8"?>"#.to_string(), "<condition>".into(), "  <group_conditions>".into()];
    for (scan, cams) in groups {
        rows.push(format!(r#"    <group><camera_amount value="{}"/><scan_direction value="{scan}"/><camera_conditions>"#, cams.len()));
        for (i, (st, ed)) in cams.iter().enumerate() {
            rows.push(format!(
                r#"      <camera_info><visual_field><start_mm value="{st}"/><end_mm value="{ed}"/></visual_field><configuration_info><lsc_no value="{}"/></configuration_info></camera_info>"#,
                i + 1
            ));
        }
        rows.push("    </camera_conditions></group>".into());
    }
    rows.push("  </group_conditions>".into());
    rows.push("</condition>".into());
    rows.join("\n") + "\n"
}

const INSP_DEF: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<condition>
  <!-- 条件の頭 -->
  <header>
    <!-- 条件名 -->
    <cond_name value=""/>
  </header>
  <target_conditions><target><roll_info>
    <!-- コメント -->
    <comments><comment value=""/></comments>
  </roll_info></target></target_conditions>
  <!-- 分類（色・記号） -->
  <classification_conditions><classification_condition>
    <!-- 分類名 -->
    <name value=""/>
  </classification_condition></classification_conditions>
  <!-- 面の条件 -->
  <group_conditions><group>
    <!-- 表示名 -->
    <disp_name value=""/>
  </group></group_conditions>
</condition>
"#;

// ------------------------------------------------------------------ 画像（8 ビットの BMP）と CAB（MSZIP）
/// 8 ビットの BMP（地は濃淡のばらつき〈実物に近い圧縮の効きにくさ〉、暗い帯が 1 本）
pub fn bmp(w: usize, h: usize, seed: u64) -> Vec<u8> {
    let mut rnd = Random::from_int(seed);
    let stride = (w + 3) & !3;
    let noise: Vec<u8> = rnd.randbytes(stride * h).into_iter().map(|b| 150 + (b as u32 * 41 / 256) as u8).collect();
    let (cx, cy) = (rnd.randrange(w as i64 / 4, 3 * w as i64 / 4), rnd.randrange(h as i64 / 4, 3 * h as i64 / 4));
    let r = 4.max(w.min(h) as i64 / 10);
    let mut pixels = Vec::with_capacity(stride * h);
    for y in 0..h {
        let mut row = noise[y * stride..(y + 1) * stride].to_vec();
        if (y as i64 - cy).abs() < r {
            let (a, b) = (0.max(cx - r) as usize, (w as i64).min(cx + r) as usize);
            row[a..b].fill(40);
        }
        pixels.extend(row);
    }
    let pal: Vec<u8> = (0..=255u8).flat_map(|i| [i, i, i, 0]).collect();
    let off = (14 + 40 + pal.len()) as u32;
    let mut out = b"BM".to_vec();
    out.extend((off + pixels.len() as u32).to_le_bytes());
    out.extend([0u8; 4]);
    out.extend(off.to_le_bytes());
    for v in [40u32, w as u32, h as u32] {
        out.extend(v.to_le_bytes());
    }
    out.extend(1u16.to_le_bytes());
    out.extend(8u16.to_le_bytes());
    for v in [0u32, pixels.len() as u32, 2835, 2835, 256, 0] {
        out.extend(v.to_le_bytes());
    }
    out.extend(pal);
    out.extend(pixels);
    out
}

/// CAB（1 フォルダ・MSZIP）。CFDATA は 32KB ごとに独立した deflate（前の塊を辞書に使わない）
pub fn cab(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let data: Vec<u8> = files.iter().flat_map(|(_, b)| b.iter().copied()).collect();
    let mut blocks = vec![];
    let mut i = 0;
    loop {
        let raw = &data[i..(i + 32768).min(data.len())];
        let mut e = DeflateEncoder::new(b"CK".to_vec(), Compression::best());
        e.write_all(raw).unwrap();
        blocks.push((e.finish().unwrap(), raw.len()));
        i += 32768;
        if i >= data.len() {
            break;
        }
    }
    let mut cffiles = vec![];
    let mut pos = 0u32;
    for (name, body) in files {
        for v in [body.len() as u32, pos] {
            cffiles.extend(v.to_le_bytes());
        }
        for v in [0u16, 0x5A21, 0x8000, 0x20] {
            cffiles.extend(v.to_le_bytes());
        }
        cffiles.extend(name.as_bytes());
        cffiles.push(0);
        pos += body.len() as u32;
    }
    let (head_len, folder_len) = (36u32, 8u32);
    let data_off = head_len + folder_len + cffiles.len() as u32;
    let mut cfdata = vec![];
    for (c, n) in &blocks {
        cfdata.extend(0u32.to_le_bytes());
        cfdata.extend((c.len() as u16).to_le_bytes());
        cfdata.extend((*n as u16).to_le_bytes());
        cfdata.extend(c);
    }
    let total = data_off + cfdata.len() as u32;
    let mut out = b"MSCF".to_vec();
    for v in [0u32, total, 0, head_len + folder_len, 0] {
        out.extend(v.to_le_bytes());
    }
    out.extend([3u8, 1]);
    for v in [1u16, files.len() as u16, 0, 0, 0] {
        out.extend(v.to_le_bytes());
    }
    out.extend(data_off.to_le_bytes());
    out.extend((blocks.len() as u16).to_le_bytes());
    out.extend(1u16.to_le_bytes()); // 1 = MSZIP
    out.extend(cffiles);
    out.extend(cfdata);
    out
}

// ------------------------------------------------------------------ ロット
const LS3_KINDS: &[(&str, &str, &str)] = &[
    ("未分類", "・", "128,128,128"),
    ("穴", "●", "220,40,40"),
    ("汚れ", "▲", "40,120,220"),
    ("キズ", "■", "40,160,80"),
    ("周期", "★", "200,120,0"),
];
const COMMENTS: &[&str] = &["L2610-0042", "3", "C-12", "缶材", "A5182", "H19", "0.245", "1650", "K-88", "1", "標準", "飲料缶"];

fn lot_dir(root: &Path, eq: &str, name: &str) -> PathBuf {
    let (y, mo, d) = (&name[..4], &name[5..7], &name[8..10]);
    let p = root.join(eq).join(y).join(format!("{y}_{mo}")).join(format!("{y}_{mo}_{d}")).join(name);
    mkdir(&p);
    p
}

fn mkdir(p: &Path) {
    std::fs::create_dir_all(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
}

fn write(p: &Path, body: impl AsRef<[u8]>) {
    std::fs::write(p, body).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
}

/// 欠陥の並び。転写（表裏で近い位置）・ピッチ（等間隔）・多量を含む
fn detects_for(base: Time, n_img: usize, rnd: &mut Random) -> Vec<Rec> {
    let mut recs: Vec<Rec> = vec![];
    let mut add = |group: i64, x: f64, y: f64, kind: i64, typ: i64, w: f64, ln: f64| {
        let i = recs.len() as i64;
        recs.push(vec![
            ("detectNo", Val::I(i + 1)),
            ("type", Val::I(typ)),
            ("kindID", Val::I(kind)),
            ("group", Val::I(group)),
            ("camera", Val::I(group * 3 + floordiv(x, 560.0) as i64)),
            ("x_mm", Val::F(100.0 + x)),
            ("base_x", Val::F(100.0)),
            ("x_end", Val::F(100.0 + 1650.0)),
            ("y_mm", Val::F(y * 1000.0)),
            ("width_mm", Val::F(w)),
            ("length_mm", Val::F(ln)),
            ("area_mm", Val::F(round3(w * ln * 0.8))),
            ("peek_level1", Val::I(200 + i % 40)),
            ("peek_level2", Val::I(-(30 + i % 50))),
            ("ave_level2", Val::F(61.5 + (i % 7) as f64 * 0.25)),
            ("line_speed", Val::F(250.0)),
            ("datetime", ticks(base.plus_seconds(30.0 + y * 0.24), 2, true)),
            ("image_id", Val::I(70000 + i * 3)),
        ]);
    };
    for k in 0..n_img as i64 {
        let x = rnd.uniform(50.0, 1600.0);
        let y = rnd.uniform(1.0, 3000.0);
        add(k % 2, x, y, 1 + k % 4, 1, 1.2, 2.5);
    }
    // 転写: 表(1)と裏(0)で幅方向が 2mm 以内
    for k in 0..6 {
        let (x, y) = (300.0 + k as f64 * 180.0, 500.0 + k as f64 * 400.0);
        add(1, x, y, 2, 1, 1.2, 2.5);
        let dx = rnd.uniform(-2.0, 2.0);
        let dy = rnd.uniform(-3.0, 3.0);
        add(0, x + dx, y + dy, 2, 1, 1.2, 2.5);
    }
    // ピッチ: 面 1、幅 812mm、間隔 1.571m（1 つ欠け）
    for j in [0, 1, 2, 4, 5, 6] {
        let x = 812.0 + rnd.uniform(-1.5, 1.5);
        let y = 1200.0 + j as f64 * 1.571 + rnd.uniform(-0.01, 0.01);
        add(1, x, y, 4, 1, 1.2, 2.5);
    }
    // 多量: type=2・kindID=1100
    for j in 0..5 {
        add(0, 900.0, 2500.0 + (j / 2) as f64 * 0.5, 1100, 2, 1650.0, 500.0);
    }
    recs
}

/// Python の round(x, 3)（ここで使う値は丁度の半分にならない）
fn round3(x: f64) -> f64 {
    format!("{x:.3}").parse().unwrap()
}

fn int_of(r: &Rec, k: &str) -> i64 {
    match get(r, k) {
        Some(Val::I(i)) => *i,
        _ => 0,
    }
}

/// LS3 のロット（n_cab 個の CAB × per_cab 枚の w×h の BMP。fm: フォルダの画像も作る）
pub fn make_ls3(root: &Path, name: &str, n_cab: usize, per_cab: usize, w: usize, h: usize, fm: bool) -> PathBuf {
    let lot = lot_dir(root, "LS3", name);
    let base = Time::parse(name);
    let mut rnd = Random::from_text(name);
    mkdir(&lot.join("cond"));
    mkdir(&lot.join("option"));
    write(&lot.join("cond").join("COND01.xml"), cond_xml(LS3_KINDS, COMMENTS));
    write(&lot.join("cond").join("Common.xml"), common_xml(&[("裏面", "30,90,168"), ("表面", "200,60,40")]));
    let cams: &[(u32, u32)] = &[(0, 560), (560, 1120), (1120, 1700)];
    write(&lot.join("cond").join("SystemCond.xml"), system_xml(&[("0", cams), ("1", cams)]));
    write(&lot.join("option").join("InspectDataInfo.xml"), sjis(&defs_xml()));
    write(&lot.join("option").join("InspCondDef.xml"), INSP_DEF);
    let n_img = n_cab * per_cab;
    let recs = detects_for(base, n_img.max(40), &mut rnd);
    write_dat(&lot.join("DETECT_INFO.dat"), "DETECT_INFO", &recs, None);
    let mut links = vec![];
    let mut fno = 0i64;
    if n_cab > 0 {
        let img = lot.join("img");
        mkdir(&img);
        for c in 0..n_cab {
            let mut files = vec![];
            for k in 0..per_cab {
                files.push((format!("{fno}.bmp"), bmp(w, h, fno as u64)));
                if k < 3 && w <= 128 {
                    // 画像ごとの XML（画像情報に出る。正解データの小さなロットだけ）
                    let gain = 1.5 + k as f64;
                    let xml = format!(
                        r#"<?xml version="1.0" encoding="utf-8"?><image><camera_gain value="{gain:?}"/><memo>試験 {fno}</memo></image>"#
                    );
                    files.push((format!("{fno}_info.xml"), xml.into_bytes()));
                }
                // 画像 N.bmp → 欠陥。順番を少しずらす（記録順と画像の順は一致しない）
                let j = (fno * 7) as usize % recs.len();
                let di = if int_of(&recs[j], "type") == 1 { j } else { 0 };
                links.push(vec![
                    ("image_fileno", Val::I(fno)),
                    ("detect_recno", Val::I(di as i64)),
                    ("image_id", Val::I(int_of(&recs[di], "image_id"))),
                ]);
                fno += 1;
            }
            write(&img.join(format!("{c:04}.cab")), cab(&files));
        }
        write_dat(&lot.join("IMAGE_LINK.dat"), "IMAGE_LINK", &links, None);
    }
    if fm {
        let fmd = lot.join("fm_img").join("0000");
        mkdir(&fmd);
        let mut fl = vec![];
        for k in 0..6usize {
            write(&fmd.join(format!("{k}.bmp")), bmp(64, 48, 1000 + k as u64));
            fl.push(vec![
                ("image_fileno", Val::I(k as i64)),
                ("detect_recno", Val::I(k as i64 + 1)),
                ("image_id", Val::I(int_of(&recs[k + 1], "image_id"))),
            ]);
        }
        write_dat(&lot.join("FM_IMAGE_LINK.DAT"), "FM_IMAGE_LINK", &fl, None);
    }
    let mut cc = vec![0i64; 8];
    for r in &recs {
        let k = int_of(r, "kindID");
        if int_of(r, "type") == 1 && k < 8 {
            cc[k as usize] += 1;
        }
    }
    // INSP_INFO は現地時刻のまま保存（Kind=Local）。DETECT_INFO は UTC 保存
    let insp: Rec = vec![
        ("start_time", ticks(base.plus_seconds(5.0), 2, false)),
        ("end_time", ticks(base.plus_minutes(13), 2, false)),
        ("insp_end_y", Val::F(3021500.0)),
        ("detect_total_cnt", Val::I(recs.iter().filter(|r| int_of(r, "type") == 1).count() as i64)),
        ("image_total_cnt", Val::I(n_img as i64)),
        ("insp_area_st", Val::F(12.5)),
        ("insp_area_ed", Val::F(1662.5)),
        ("classification_count", Val::L(cc)),
        ("error_count", Val::I(5)),
        ("detect_max_status", Val::I(0)),
        ("insp_state", Val::I(1)),
        ("ok", Val::B(true)),
        ("product", Val::S("缶材 A5182".into())),
        ("note", Val::S("試験ロット".into())),
    ];
    write_dat(&lot.join("INSP_INFO.DAT"), "INSP_INFO", &[insp], Some(fixed_size(&fields_of("INSP_INFO")) + 24));
    let stat: Vec<Rec> =
        (0..12).map(|i| vec![("seq", Val::I(i)), ("time", ticks(base.plus_minutes(i), 0, false)), ("count", Val::I(i * 3))]).collect();
    write_dat(&lot.join("STAT_INFO.dat"), "STAT_INFO", &stat, None);
    let mask: Rec = vec![("date_time", ticks(base.plus_minutes(-2), 2, true)), ("mask", Val::L(vec![3, 5]))];
    write_dat(&lot.join("SLIT_MASK_STAT.dat"), "SLIT_MASK_STAT", &[mask], None);
    write(&lot.join("notes.txt"), b"memo");
    lot
}

/// 画像なし・表裏が逆・COND は wavedata/cond だけ・欠陥数上限オーバー
/// （max_status=0 で上限なし。画面の確かめ noimage-check が別の設備 eq に作る）
pub fn make_dl2(root: &Path, name: &str, eq: &str, max_status: i64) -> PathBuf {
    let lot = lot_dir(root, eq, name);
    let base = Time::parse(name);
    let wc = lot.join("wavedata").join("cond");
    mkdir(&wc);
    mkdir(&lot.join("option"));
    let kinds = [
        ("未分類", "・", "128,128,128"),
        ("表濃", "●", "200,0,0"),
        ("表淡", "○", "200,90,90"),
        ("裏濃", "◆", "0,0,200"),
        ("裏淡", "◇", "90,90,200"),
        ("表周期", "★", "200,120,0"),
        ("裏周期", "☆", "0,120,200"),
    ];
    let mut comments = vec!["D-7781"];
    comments.extend_from_slice(&COMMENTS[1..]);
    write(&wc.join("COND02.xml"), cond_xml(&kinds, &comments));
    write(&lot.join("option").join("Common.xml"), common_xml(&[("表面", "200,60,40"), ("裏面", "30,90,168")]));
    write(&lot.join("option").join("InspectDataInfo.xml"), sjis(&defs_xml()));
    let mut rnd = Random::from_text(name);
    let recs = detects_for(base, 30, &mut rnd);
    write_dat(&lot.join("DETECT_INFO.dat"), "DETECT_INFO", &recs, None);
    let insp: Rec = vec![
        ("start_time", ticks(base.plus_minutes(25), 2, true)),
        ("end_time", ticks(base.plus_minutes(40), 2, true)),
        ("insp_end_y", Val::F(1800000.0)),
        ("detect_total_cnt", Val::I(recs.len() as i64)),
        ("image_total_cnt", Val::I(0)),
        ("insp_area_st", Val::F(0.0)),
        ("insp_area_ed", Val::F(1250.0)),
        ("classification_count", Val::L(vec![0; 8])),
        ("error_count", Val::I(0)),
        ("detect_max_status", Val::I(max_status)),
        ("insp_state", Val::I(2)),
        ("ok", Val::B(false)),
        ("product", Val::S("DL".into())),
        ("note", Val::S(String::new())),
    ];
    write_dat(&lot.join("INSP_INFO.DAT"), "INSP_INFO", &[insp], Some(fixed_size(&fields_of("INSP_INFO")) + 8));
    lot
}

/// 正解データ用の小さな木（3 ロット）
pub fn golden_tree(root: &Path) -> Vec<PathBuf> {
    let lots = vec![
        make_ls3(root, "2026_10_25_22_03_53", 3, 8, 96, 72, true),
        make_ls3(root, "2026_10_25_08_15_00", 0, 0, 0, 0, false),
        make_dl2(root, "2026_10_23_21_27_46", "DL2", 1),
    ];
    mkdir(&root.join("LS3").join("2026").join("2026_10").join("2026_10_25").join("work"));
    lots
}

/// 速さを測る大きなロット
pub fn bench_lot(root: &Path, n_cab: usize, w: usize, h: usize) -> PathBuf {
    make_ls3(root, "2026_10_26_10_00_00", n_cab, 100, w, h, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn files(root: &Path) -> Vec<PathBuf> {
        let mut out = vec![];
        let mut stack = vec![root.to_path_buf()];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(d).unwrap().flatten() {
                if e.path().is_dir() {
                    stack.push(e.path());
                } else {
                    out.push(e.path());
                }
            }
        }
        out.sort();
        out
    }

    fn digest(root: &Path) -> String {
        let mut h = Sha256::new();
        for p in files(root) {
            h.update(p.strip_prefix(root).unwrap().to_string_lossy().as_bytes());
            h.update(std::fs::read(&p).unwrap());
        }
        format!("{:x}", h.finalize())
    }

    /// 毎回同じ物（正解データと突き合わせるため）で、検査計の形（.dat の頭・CAB の MSZIP）になっている
    #[test]
    fn same_every_time_and_well_formed() {
        let base = std::env::temp_dir().join(format!("dt-fixture-{}", std::process::id()));
        let (a, b) = (base.join("a"), base.join("b"));
        let lots = golden_tree(&a);
        golden_tree(&b);
        assert_eq!(digest(&a), digest(&b));
        let head = std::fs::read(lots[0].join("DETECT_INFO.dat")).unwrap();
        let i32_at = |o: usize| i32::from_le_bytes(head[o..o + 4].try_into().unwrap()) as usize;
        assert_eq!((i32_at(0), i32_at(4)), (13 + "DETECT_INFO".len(), 100));
        assert_eq!((head.len() - i32_at(0)) % (i32_at(8) + 1), 0, "頭のあとは 1 バイトの印 + 1 件分の繰り返し");
        let cab = std::fs::read(lots[0].join("img").join("0000.cab")).unwrap();
        assert_eq!(&cab[..4], b"MSCF");
        let off = u32::from_le_bytes(cab[36..40].try_into().unwrap()) as usize;
        let (cb, ucb) =
            (u16::from_le_bytes([cab[off + 4], cab[off + 5]]) as usize, u16::from_le_bytes([cab[off + 6], cab[off + 7]]) as usize);
        let block = &cab[off + 8..off + 8 + cb];
        assert_eq!(&block[..2], b"CK");
        let mut out = vec![];
        std::io::Read::read_to_end(&mut flate2::read::DeflateDecoder::new(&block[2..]), &mut out).unwrap();
        assert_eq!(out.len(), ucb);
        let _ = std::fs::remove_dir_all(&base);
    }
}
