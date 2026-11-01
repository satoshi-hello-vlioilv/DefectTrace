//! アプリのアイコン（exe・窓・タスクバー・起動画面）を描く。作るとき desktop/build.rs が呼ぶ（外のプログラムを起こさない）。
//!
//! 絵: 藍の地に、検査した板（淡い帯）と欠陥（赤い点）、そのひとつを見るアンバーの虫めがね。
//! 「板の上の欠陥をたどって、画像で確かめる」というアプリの仕事を表す。
//! 形は「中心からの距離」（SDF）で書き、縁は 1px の幅でぼかす（どの大きさでも同じ式で描け、縮めて潰れない）。
//! 描いた物は .ico・.png にして書き出す（リポジトリには置かない。同じ絵を 2 か所に持たない）。

use flate2::{write::ZlibEncoder, Compression, Crc};
use std::io::Write;

/// .ico に入れる大きさ（Windows が表示の倍率で選ぶ）
pub const SIZES: [u32; 8] = [16, 20, 24, 32, 40, 48, 64, 256];

type Rgb = [f64; 3];

const fn hex(h: u32) -> Rgb {
    [((h >> 16) & 255) as f64 / 255.0, ((h >> 8) & 255) as f64 / 255.0, (h & 255) as f64 / 255.0]
}

const NAVY0: Rgb = hex(0x1c3550);
const NAVY1: Rgb = hex(0x2b5f79);
const PALE: Rgb = hex(0xe8f1f4);
const RED: Rgb = hex(0xe0412c);
const AMBER: Rgb = hex(0xe6a52e);

/// 欠陥の点の中心（座標は 0〜1）
pub const DOTS: [(f64, f64); 3] = [(0.36, 0.27), (0.47, 0.47), (0.34, 0.71)];
/// 虫めがねの中心
pub const LENS: (f64, f64) = (0.60, 0.56);

/// 形（中心からの距離）
enum Shape {
    RoundRect { cx: f64, cy: f64, hw: f64, hh: f64, r: f64 },
    Circle { cx: f64, cy: f64, r: f64 },
    Ring { cx: f64, cy: f64, r: f64, w: f64 },
    Segment { ax: f64, ay: f64, bx: f64, by: f64, r: f64 },
}

impl Shape {
    fn dist(&self, x: f64, y: f64) -> f64 {
        match *self {
            Shape::RoundRect { cx, cy, hw, hh, r } => {
                let (qx, qy) = ((x - cx).abs() - hw + r, (y - cy).abs() - hh + r);
                qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - r
            }
            Shape::Circle { cx, cy, r } => (x - cx).hypot(y - cy) - r,
            Shape::Ring { cx, cy, r, w } => ((x - cx).hypot(y - cy) - r).abs() - w,
            Shape::Segment { ax, ay, bx, by, r } => {
                let (dx, dy) = (bx - ax, by - ay);
                let h = (((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
                (x - ax - dx * h).hypot(y - ay - dy * h) - r
            }
        }
    }
}

/// 塗り（地は左上から右下へ藍の濃淡）
enum Paint {
    Ground,
    Flat(Rgb),
}

impl Paint {
    fn at(&self, x: f64, y: f64) -> Rgb {
        match self {
            Paint::Ground => {
                let t = ((x + y) / 2.0).clamp(0.0, 1.0);
                [0, 1, 2].map(|i| NAVY0[i] + (NAVY1[i] - NAVY0[i]) * t)
            }
            Paint::Flat(c) => *c,
        }
    }
}

/// 描く順（後ろほど上）
fn shapes() -> Vec<(Shape, Paint)> {
    let mut s = vec![
        (Shape::RoundRect { cx: 0.5, cy: 0.5, hw: 0.44, hh: 0.44, r: 0.13 }, Paint::Ground),
        (Shape::RoundRect { cx: 0.41, cy: 0.5, hw: 0.15, hh: 0.36, r: 0.04 }, Paint::Flat(PALE)),
    ];
    s.extend(DOTS.iter().map(|&(cx, cy)| (Shape::Circle { cx, cy, r: 0.055 }, Paint::Flat(RED))));
    s.push((Shape::Ring { cx: LENS.0, cy: LENS.1, r: 0.17, w: 0.035 }, Paint::Flat(AMBER)));
    s.push((Shape::Segment { ax: 0.72, ay: 0.68, bx: 0.83, by: 0.79, r: 0.055 }, Paint::Flat(AMBER)));
    s
}

/// size×size の RGBA（行ごとに並べた 1 つの列）。
pub fn rgba(size: u32) -> Vec<u8> {
    let px = 1.0 / size as f64;
    let shapes = shapes();
    let mut out = Vec::with_capacity((size * size * 4) as usize);
    for j in 0..size {
        let y = (j as f64 + 0.5) / size as f64;
        for i in 0..size {
            let x = (i as f64 + 0.5) / size as f64;
            let (mut c, mut a) = ([0.0f64; 3], 0.0f64);
            for (shape, paint) in &shapes {
                let cov = (0.5 - shape.dist(x, y) / px).clamp(0.0, 1.0);
                if cov <= 0.0 {
                    continue;
                }
                let p = paint.at(x, y);
                c = [0, 1, 2].map(|k| p[k] * cov + c[k] * (1.0 - cov));
                a = cov + a * (1.0 - cov);
            }
            let byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round_ties_even() as u8;
            if a > 0.0 {
                out.extend([byte(c[0] / a), byte(c[1] / a), byte(c[2] / a), (a * 255.0).round_ties_even() as u8]);
            } else {
                out.extend([0, 0, 0, 0]);
            }
        }
    }
    out
}

/// PNG（RGBA・8 ビット）。
pub fn png(size: u32) -> Vec<u8> {
    let rows = rgba(size);
    let mut raw = Vec::with_capacity(rows.len() + size as usize);
    for row in rows.chunks((size * 4) as usize) {
        raw.push(0);
        raw.extend_from_slice(row);
    }
    let mut z = ZlibEncoder::new(Vec::new(), Compression::best());
    z.write_all(&raw).expect("圧縮");
    let mut ihdr = vec![];
    ihdr.extend(size.to_be_bytes());
    ihdr.extend(size.to_be_bytes());
    ihdr.extend([8, 6, 0, 0, 0]);
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    for (kind, data) in [(&b"IHDR"[..], ihdr), (b"IDAT", z.finish().expect("圧縮")), (b"IEND", vec![])] {
        out.extend((data.len() as u32).to_be_bytes());
        let mut crc = Crc::new();
        crc.update(kind);
        crc.update(&data);
        out.extend(kind);
        out.extend(data);
        out.extend(crc.sum().to_be_bytes());
    }
    out
}

/// .ico（中身は大きさごとの PNG。Windows Vista 以降が読む形）。
pub fn ico() -> Vec<u8> {
    let images: Vec<Vec<u8>> = SIZES.iter().map(|&s| png(s)).collect();
    let mut out = vec![];
    for v in [0u16, 1, images.len() as u16] {
        out.extend(v.to_le_bytes());
    }
    let mut offset = 6 + 16 * images.len() as u32;
    for (s, data) in SIZES.iter().zip(&images) {
        out.extend([(s % 256) as u8, (s % 256) as u8, 0, 0]);
        out.extend(1u16.to_le_bytes());
        out.extend(32u16.to_le_bytes());
        out.extend((data.len() as u32).to_le_bytes());
        out.extend(offset.to_le_bytes());
        offset += data.len() as u32;
    }
    for data in images {
        out.extend(data);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(px: &[u8], size: u32, x: f64, y: f64) -> [u8; 4] {
        let (i, j) = ((x * size as f64) as usize, (y * size as f64) as usize);
        let o = (j * size as usize + i) * 4;
        px[o..o + 4].try_into().unwrap()
    }

    /// 欠陥の点は赤・虫めがねの縁はアンバー・角の外は透明・地は藍。どの大きさでも .ico に入る
    #[test]
    fn draws_the_picture() {
        let px = rgba(256);
        // 虫めがねの縁（中心から 0.17 ± 0.035）の下の点は、縁の色に隠れる（虫めがねが欠陥を見ている絵）
        let open = DOTS.iter().filter(|(x, y)| ((x - LENS.0).hypot(y - LENS.1) - 0.17).abs() > 0.035 + 0.055);
        assert_eq!(open.clone().count(), 2, "縁に隠れない点は 2 つ");
        for &(x, y) in open {
            let [r, g, b, a] = at(&px, 256, x, y);
            assert!(r > 200 && g < 100 && b < 80 && a == 255, "欠陥の点 {:?}", (r, g, b, a));
        }
        let [r, g, _, _] = at(&px, 256, LENS.0 + 0.17, LENS.1);
        assert!(r > 200 && g > 140, "虫めがねの縁");
        assert_eq!(at(&px, 256, 0.01, 0.01)[3], 0, "角の外は透明");
        let [r, _, b, a] = at(&px, 256, 0.9, 0.2);
        assert!(b > r && a == 255, "地は藍");
        let ico = ico();
        assert_eq!(u16::from_le_bytes([ico[4], ico[5]]) as usize, SIZES.len());
        assert_eq!(&png(16)[1..4], b"PNG");
    }
}
