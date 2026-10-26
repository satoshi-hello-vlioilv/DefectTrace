//! 縮小画像（一覧のカード用の JPEG）を作る。
//!
//! 検査計の画像はほとんどが無圧縮の BMP（8 ビットの濃淡・24 ビット）。BMP はここで直に読み、面積平均で縮める
//! （縮める倍率が大きくても細い欠陥が消えにくい・1 画素ずつの補間より速い）。BMP 以外（JPEG・PNG・TIFF）と、
//! 読めない BMP（RLE など）は image クレートで読む。濃淡の画像は濃淡の JPEG にする（色の 3 倍の手間をかけない）。

use std::path::Path;

/// 読んだ画像（濃淡 1 か色 3 のチャンネル、上の行から）。
pub struct Raster {
    pub w: usize,
    pub h: usize,
    pub ch: usize,
    pub px: Vec<u8>,
}

fn le16(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}
fn le32(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

/// BMP の頭（幅・高さ・ビット数）。画像情報の表示に使う（版 3.8 と同じく、読めなければ 0）。
pub fn bmp_size(head: &[u8]) -> (i64, i64, i64) {
    if head.get(..2) != Some(b"BM") {
        return (0, 0, 0);
    }
    let w = le32(head, 18).map(|v| v as i32 as i64).unwrap_or(0);
    let h = le32(head, 22).map(|v| (v as i32 as i64).abs()).unwrap_or(0);
    let bits = le16(head, 28).unwrap_or(0) as i64;
    (w, h, bits)
}

/// 無圧縮の BMP（1・4・8 ビットのパレット、16・24・32 ビット）を読む。読めない形は None。
pub fn decode_bmp(b: &[u8]) -> Option<Raster> {
    if b.get(..2)? != b"BM" {
        return None;
    }
    let off = le32(b, 10)? as usize;
    let hsz = le32(b, 14)? as usize;
    let w = le32(b, 18)? as i32;
    let hraw = le32(b, 22)? as i32;
    let bits = le16(b, 28)? as usize;
    let comp = le32(b, 30)?;
    if w <= 0 || hraw == 0 || !(comp == 0 || (comp == 3 && (bits == 16 || bits == 32))) {
        return None;
    }
    let (w, h, top_down) = (w as usize, hraw.unsigned_abs() as usize, hraw < 0);
    let stride = (w * bits).div_ceil(32) * 4;
    if b.len() < off + stride * (h - 1) + (w * bits).div_ceil(8) {
        return None;
    }
    let row = |y: usize| -> &[u8] {
        let sy = if top_down { y } else { h - 1 - y };
        &b[off + sy * stride..]
    };
    if bits <= 8 {
        let n = le32(b, 46).filter(|n| *n > 0).map(|n| n as usize).unwrap_or(1 << bits).min(256);
        let pal_at = 14 + hsz;
        let pal: Vec<[u8; 3]> =
            (0..n).map(|i| b.get(pal_at + i * 4..pal_at + i * 4 + 3).map(|c| [c[2], c[1], c[0]]).unwrap_or([0, 0, 0])).collect();
        let gray = pal.iter().all(|c| c[0] == c[1] && c[1] == c[2]);
        let ch = if gray { 1 } else { 3 };
        let mut px = Vec::with_capacity(w * h * ch);
        let per = 8 / bits;
        let mask = ((1u16 << bits) - 1) as u8;
        for y in 0..h {
            let r = row(y);
            for x in 0..w {
                let idx = if bits == 8 { r[x] } else { (r[x / per] >> ((per - 1 - x % per) * bits)) & mask } as usize;
                let c = pal.get(idx).copied().unwrap_or([0, 0, 0]);
                if gray {
                    px.push(c[0]);
                } else {
                    px.extend_from_slice(&c);
                }
            }
        }
        return Some(Raster { w, h, ch, px });
    }
    let mut px = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        let r = row(y);
        for x in 0..w {
            match bits {
                24 => px.extend_from_slice(&[r[x * 3 + 2], r[x * 3 + 1], r[x * 3]]),
                32 => px.extend_from_slice(&[r[x * 4 + 2], r[x * 4 + 1], r[x * 4]]),
                16 => {
                    let v = u16::from_le_bytes([r[x * 2], r[x * 2 + 1]]);
                    let c = |s: u16| ((((v >> s) & 31) as u32 * 255 + 15) / 31) as u8;
                    px.extend_from_slice(&[c(10), c(5), c(0)]);
                }
                _ => return None,
            }
        }
    }
    Some(Raster { w, h, ch: 3, px })
}

/// どの形の画像でも読む（BMP は直に、ほかは image クレートで）。
pub fn decode(bytes: &[u8]) -> Result<Raster, String> {
    if let Some(r) = decode_bmp(bytes) {
        return Ok(r);
    }
    let img = image::load_from_memory(bytes).map_err(|e| format!("画像を読めません: {e}"))?;
    let gray = matches!(img.color(), image::ColorType::L8 | image::ColorType::L16 | image::ColorType::La8 | image::ColorType::La16);
    Ok(if gray {
        let g = img.to_luma8();
        Raster { w: g.width() as usize, h: g.height() as usize, ch: 1, px: g.into_raw() }
    } else {
        let c = img.to_rgb8();
        Raster { w: c.width() as usize, h: c.height() as usize, ch: 3, px: c.into_raw() }
    })
}

/// 縦横比を保って size の枠に収まる大きさ（大きくはしない）。
pub fn fit(w: usize, h: usize, size: usize) -> (usize, usize) {
    if w <= size && h <= size {
        return (w, h);
    }
    if w >= h {
        (size, ((h * size) as f64 / w as f64).round().max(1.0) as usize)
    } else {
        (((w * size) as f64 / h as f64).round().max(1.0) as usize, size)
    }
}

/// 面積平均で縮める。
pub fn shrink(r: &Raster, tw: usize, th: usize) -> Raster {
    if tw == r.w && th == r.h {
        return Raster { w: r.w, h: r.h, ch: r.ch, px: r.px.clone() };
    }
    let ch = r.ch;
    // 出力の各列が覆う元の列の範囲（少なくとも 1 列）
    let span = |n: usize, t: usize, i: usize| -> (usize, usize) {
        let a = i * n / t;
        let b = ((i + 1) * n / t).max(a + 1).min(n);
        (a, b)
    };
    let cols: Vec<(usize, usize)> = (0..tw).map(|x| span(r.w, tw, x)).collect();
    let mut out = vec![0u8; tw * th * ch];
    let mut acc = vec![0u32; tw * ch];
    for ty in 0..th {
        let (y0, y1) = span(r.h, th, ty);
        acc.iter_mut().for_each(|a| *a = 0);
        for y in y0..y1 {
            let row = &r.px[y * r.w * ch..(y + 1) * r.w * ch];
            for (tx, &(x0, x1)) in cols.iter().enumerate() {
                for c in 0..ch {
                    let mut s = 0u32;
                    for x in x0..x1 {
                        s += row[x * ch + c] as u32;
                    }
                    acc[tx * ch + c] += s;
                }
            }
        }
        for (tx, &(x0, x1)) in cols.iter().enumerate() {
            let n = ((x1 - x0) * (y1 - y0)) as u32;
            for c in 0..ch {
                out[(ty * tw + tx) * ch + c] = ((acc[tx * ch + c] + n / 2) / n) as u8;
            }
        }
    }
    Raster { w: tw, h: th, ch, px: out }
}

/// JPEG に書く（品質 85。版 3.8 の縮小画像と同じ）。
pub fn jpeg(r: &Raster) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(r.w * r.h / 4 + 1024);
    let ct = if r.ch == 1 { jpeg_encoder::ColorType::Luma } else { jpeg_encoder::ColorType::Rgb };
    let (w, h) = (u16::try_from(r.w).map_err(|_| "大きすぎます")?, u16::try_from(r.h).map_err(|_| "大きすぎます")?);
    jpeg_encoder::Encoder::new(&mut out, 85).encode(&r.px, w, h, ct).map_err(|e| e.to_string())?;
    Ok(out)
}

/// 画像のバイト列 → 縮小画像の JPEG。
pub fn thumb_bytes(src: &[u8], size: usize) -> Result<Vec<u8>, String> {
    let r = decode(src)?;
    let (tw, th) = fit(r.w, r.h, size);
    jpeg(&shrink(&r, tw, th))
}

/// 縮小画像を書く（一時の名前に書いてから付け替える。途中で止まっても半端な JPEG を残さない）。
pub fn write_atomic(dst: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(d) = dst.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = dst.with_extension(format!("tmp{}-{:?}", std::process::id(), std::thread::current().id()).replace(['(', ')'], ""));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, dst).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// 8 ビット濃淡の BMP（下の行から）。
    pub fn bmp8(w: usize, h: usize, f: impl Fn(usize, usize) -> u8) -> Vec<u8> {
        let stride = (w + 3) & !3;
        let mut px = vec![0u8; stride * h];
        for y in 0..h {
            for x in 0..w {
                px[(h - 1 - y) * stride + x] = f(x, y);
            }
        }
        let off = 14 + 40 + 1024;
        let mut b = b"BM".to_vec();
        b.extend(((off + px.len()) as u32).to_le_bytes());
        b.extend([0; 4]);
        b.extend((off as u32).to_le_bytes());
        b.extend(40u32.to_le_bytes());
        b.extend((w as i32).to_le_bytes());
        b.extend((h as i32).to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(8u16.to_le_bytes());
        b.extend([0u8; 16]);
        b.extend(256u32.to_le_bytes());
        b.extend([0u8; 4]);
        for i in 0..=255u8 {
            b.extend([i, i, i, 0]);
        }
        b.extend(px);
        b
    }

    #[test]
    fn gray_bmp_is_read_shrunk_and_written() {
        let b = bmp8(512, 400, |x, y| if (200..230).contains(&x) && (100..130).contains(&y) { 20 } else { 170 });
        assert_eq!(bmp_size(&b), (512, 400, 8));
        let r = decode_bmp(&b).unwrap();
        assert_eq!((r.w, r.h, r.ch), (512, 400, 1));
        assert_eq!(r.px[0], 170, "上の行から");
        assert_eq!(r.px[110 * 512 + 210], 20);
        assert_eq!(fit(512, 400, 256), (256, 200));
        assert_eq!(fit(100, 80, 256), (100, 80), "大きくはしない");
        let s = shrink(&r, 256, 200);
        assert_eq!(s.px[55 * 256 + 105], 20, "欠陥は縮めても残る");
        let j = thumb_bytes(&b, 256).unwrap();
        assert_eq!(&j[..2], b"\xFF\xD8");
        let back = image::load_from_memory(&j).unwrap();
        assert_eq!((back.width(), back.height()), (256, 200));
        assert!(matches!(back.color(), image::ColorType::L8), "濃淡は濃淡の JPEG");
    }

    #[test]
    fn other_formats_and_garbage() {
        let mut png = vec![];
        image::RgbImage::from_pixel(40, 30, image::Rgb([200, 10, 10]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let j = thumb_bytes(&png, 16).unwrap();
        let back = image::load_from_memory(&j).unwrap();
        assert_eq!((back.width(), back.height()), (16, 12));
        assert!(thumb_bytes(b"not an image", 16).is_err());
        assert_eq!(bmp_size(b"xx"), (0, 0, 0));
    }
}
