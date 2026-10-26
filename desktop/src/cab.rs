//! CAB（Microsoft Cabinet）を exe の中で読む。検査計の画像は img/0000.cab … に 100 枚ずつ入っている。
//!
//! 版 3.8 までは Windows の expand.exe を 1 つの CAB ごとに起こして、ディスクへ展開してから読み直していた。ここでは:
//! - 名前の一覧は頭（CFHEADER・CFFOLDER・CFFILE）だけを読んで出す（展開せずに、画像の並びと数がすぐ分かる）
//! - 中身は、フォルダ（圧縮の単位）を頭から 1 度だけ伸ばしながら、ファイルの区切りごとに渡す（同じ所を 2 度伸ばさない）
//!
//! 圧縮は MSZIP（deflate。前の塊の 32KB を辞書に使う）・LZX・無圧縮。Quantum と複数の CAB にまたがる物は扱わない（呼ぶ側が expand.exe で読む）。
//!
//! 形は [MS-CAB] の CFHEADER・CFFOLDER・CFFILE・CFDATA。

use std::io::{self, Read};
use std::path::Path;

fn bad(why: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, why.into())
}

/// CAB の中の 1 ファイル。
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub name: String,
    pub size: u32,
    pub folder: u16,
    pub offset: u32,
}

#[derive(Debug, Clone)]
struct Folder {
    data_off: u32,
    blocks: u16,
    ctype: u16,
}

/// CAB の頭（ファイルの一覧と、圧縮の単位）。
#[derive(Debug, Clone)]
pub struct Cab {
    pub entries: Vec<Entry>,
    folders: Vec<Folder>,
    data_reserve: usize,
}

struct Rd<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Rd<'a> {
    fn take(&mut self, n: usize) -> io::Result<&'a [u8]> {
        let s = self.b.get(self.p..self.p + n).ok_or_else(|| bad("CAB が途中で切れています"))?;
        self.p += n;
        Ok(s)
    }
    fn u8(&mut self) -> io::Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> io::Result<u16> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> io::Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn cstr(&mut self) -> io::Result<&'a [u8]> {
        let rest = &self.b[self.p.min(self.b.len())..];
        let n = rest.iter().position(|&c| c == 0).ok_or_else(|| bad("CAB の名前が終わっていません"))?;
        self.p += n + 1;
        Ok(&rest[..n])
    }
}

fn name_text(raw: &[u8], utf: bool) -> String {
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) if utf => String::from_utf8_lossy(raw).into_owned(),
        Err(_) => encoding_rs::SHIFT_JIS.decode(raw).0.into_owned(),
    }
}

impl Cab {
    /// 頭を読む（data は CAB の先頭からの、少なくともファイルの一覧の終わりまで）。
    pub fn parse(data: &[u8]) -> io::Result<Cab> {
        let mut r = Rd { b: data, p: 0 };
        if r.take(4)? != b"MSCF" {
            return Err(bad("CAB ではありません（MSCF で始まりません）"));
        }
        r.u32()?;
        r.u32()?; // 全体の大きさ
        r.u32()?;
        let coff_files = r.u32()? as usize;
        r.u32()?;
        r.take(2)?; // 版
        let (n_folders, n_files, flags) = (r.u16()?, r.u16()?, r.u16()?);
        r.take(4)?; // setID・iCabinet
        let (mut folder_reserve, mut data_reserve) = (0usize, 0usize);
        if flags & 4 != 0 {
            let header_reserve = r.u16()? as usize;
            folder_reserve = r.u8()? as usize;
            data_reserve = r.u8()? as usize;
            r.take(header_reserve)?;
        }
        if flags & 1 != 0 {
            r.cstr()?;
            r.cstr()?;
        }
        if flags & 2 != 0 {
            r.cstr()?;
            r.cstr()?;
        }
        let mut folders = Vec::with_capacity(n_folders as usize);
        for _ in 0..n_folders {
            folders.push(Folder { data_off: r.u32()?, blocks: r.u16()?, ctype: r.u16()? });
            r.take(folder_reserve)?;
        }
        r.p = coff_files;
        let mut entries = Vec::with_capacity(n_files as usize);
        for _ in 0..n_files {
            let size = r.u32()?;
            let offset = r.u32()?;
            let folder = r.u16()?;
            r.take(4)?; // 日付・時刻
            let attribs = r.u16()?;
            let name = name_text(r.cstr()?, attribs & 0x80 != 0);
            if folder >= 0xFFFD {
                return Err(bad("複数の CAB にまたがるファイルは読めません"));
            }
            entries.push(Entry { name, size, folder, offset });
        }
        Ok(Cab { entries, folders, data_reserve })
    }

    /// ファイルの頭だけを読んで一覧を出す（共有の CAB でも小さく読む）。
    pub fn list(path: &Path) -> io::Result<Cab> {
        let mut f = std::fs::File::open(path)?;
        let mut head = vec![0u8; 64 * 1024];
        let mut n = 0;
        loop {
            let k = f.read(&mut head[n..])?;
            n += k;
            if k == 0 || n == head.len() {
                break;
            }
        }
        head.truncate(n);
        match Cab::parse(&head) {
            Ok(c) => Ok(c),
            // 一覧が 64KB に収まらない大きな CAB
            Err(_) if n == 64 * 1024 => Cab::parse(&std::fs::read(path)?),
            Err(e) => Err(e),
        }
    }

    pub fn names(&self) -> Vec<String> {
        self.entries.iter().map(|e| e.name.clone()).collect()
    }

    /// 全部のファイルを、CAB の中の並び（フォルダの頭から）で 1 つずつ渡す。each が Err を返せば止める。
    /// data は CAB 全体。
    pub fn extract(&self, data: &[u8], each: &mut dyn FnMut(&Entry, &[u8]) -> io::Result<()>) -> io::Result<()> {
        for (fi, folder) in self.folders.iter().enumerate() {
            let mut files: Vec<&Entry> = self.entries.iter().filter(|e| e.folder as usize == fi).collect();
            if files.is_empty() {
                continue;
            }
            files.sort_by_key(|e| e.offset);
            let mut dec = Decoder::new(folder.ctype)?;
            let mut r = Rd { b: data, p: folder.data_off as usize };
            let mut buf: Vec<u8> = Vec::new(); // 伸ばした物のうち、まだ渡していない所
            let mut base = 0u64; // buf の先頭のフォルダの中での位置
            let mut next = 0usize;
            for _ in 0..folder.blocks {
                r.u32()?; // 検査和（無いことも多い。deflate・LZX の誤りで気づく）
                let (cb, ucb) = (r.u16()? as usize, r.u16()? as usize);
                r.take(self.data_reserve)?;
                let out = dec.block(r.take(cb)?, ucb)?;
                buf.extend_from_slice(&out);
                // 揃ったファイルを渡す
                while next < files.len() {
                    let e = files[next];
                    let (st, en) = (e.offset as u64, e.offset as u64 + e.size as u64);
                    if en > base + buf.len() as u64 {
                        break;
                    }
                    let s = (st - base) as usize;
                    each(e, &buf[s..s + e.size as usize])?;
                    next += 1;
                }
                // 渡し終えた所は捨てる（大きな CAB でもメモリを抱えない）
                let keep_from = files.get(next).map(|e| e.offset as u64).unwrap_or(base + buf.len() as u64);
                let drop = (keep_from.saturating_sub(base) as usize).min(buf.len());
                buf.drain(..drop);
                base += drop as u64;
            }
            if next < files.len() {
                return Err(bad(format!("CAB の中身が足りません（{} が途中で切れています）", files[next].name)));
            }
        }
        Ok(())
    }
}

/// 圧縮の種類ごとの伸ばし方（フォルダの中で状態を持ち越す）。
enum Decoder {
    Plain,
    MsZip { inflate: flate2::Decompress, dict: Vec<u8> },
    Lzx(Box<lzxd::Lzxd>),
}

const DICT: usize = 0x8000;

impl Decoder {
    fn new(ctype: u16) -> io::Result<Decoder> {
        Ok(match ctype & 0xF {
            0 => Decoder::Plain,
            1 => Decoder::MsZip { inflate: flate2::Decompress::new(false), dict: Vec::with_capacity(DICT) },
            3 => {
                use lzxd::WindowSize::*;
                let w = match (ctype >> 8) & 0x1F {
                    15 => KB32,
                    16 => KB64,
                    17 => KB128,
                    18 => KB256,
                    19 => KB512,
                    20 => MB1,
                    21 => MB2,
                    22 => MB4,
                    23 => MB8,
                    24 => MB16,
                    25 => MB32,
                    x => return Err(bad(format!("LZX の窓の大きさが違います（{x}）"))),
                };
                Decoder::Lzx(Box::new(lzxd::Lzxd::new(w)))
            }
            2 => return Err(bad("Quantum 圧縮の CAB は読めません")),
            x => return Err(bad(format!("知らない圧縮の CAB です（{x}）"))),
        })
    }

    fn block(&mut self, data: &[u8], size: usize) -> io::Result<Vec<u8>> {
        match self {
            Decoder::Plain => Ok(data.to_vec()),
            Decoder::Lzx(d) => d.decompress_next(data, size).map(<[u8]>::to_vec).map_err(|e| bad(format!("LZX を伸ばせません: {e}"))),
            Decoder::MsZip { inflate, dict } => {
                if data.len() < 2 || &data[..2] != b"CK" {
                    return Err(bad("MSZIP の塊の印（CK）がありません"));
                }
                // 前の塊の終わり 32KB を、無圧縮の塊として先に食べさせて辞書にする
                inflate.reset(false);
                if !dict.is_empty() {
                    let n = dict.len() as u16;
                    let mut pre = Vec::with_capacity(dict.len() + 5);
                    pre.push(0);
                    pre.extend(n.to_le_bytes());
                    pre.extend((!n).to_le_bytes());
                    pre.extend_from_slice(dict);
                    let mut sink = Vec::with_capacity(dict.len());
                    inflate.decompress_vec(&pre, &mut sink, flate2::FlushDecompress::Sync).map_err(|e| bad(e.to_string()))?;
                }
                let mut out = Vec::with_capacity(size);
                inflate
                    .decompress_vec(&data[2..], &mut out, flate2::FlushDecompress::Finish)
                    .map_err(|e| bad(format!("MSZIP を伸ばせません: {e}")))?;
                if out.len() != size {
                    return Err(bad(format!("MSZIP の大きさが違います（{size} のはずが {}）", out.len())));
                }
                if out.len() >= DICT {
                    *dict = out[out.len() - DICT..].to_vec();
                } else {
                    let total = dict.len() + out.len();
                    if total > DICT {
                        dict.drain(..total - DICT);
                    }
                    dict.extend_from_slice(&out);
                }
                Ok(out)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 本物の CAB の作り方（cab クレート。MSZIP は塊をまたいで前の塊を辞書に使う）で作る。
    fn make(files: &[(&str, Vec<u8>)], ctype: cab::CompressionType) -> Vec<u8> {
        let mut b = cab::CabinetBuilder::new();
        {
            let f = b.add_folder(ctype);
            for (n, _) in files {
                f.add_file(*n);
            }
        }
        let mut w = b.build(std::io::Cursor::new(Vec::new())).unwrap();
        let mut i = 0;
        while let Some(mut fw) = w.next_file().unwrap() {
            fw.write_all(&files[i].1).unwrap();
            i += 1;
        }
        w.finish().unwrap().into_inner()
    }

    fn body(seed: u32, n: usize) -> Vec<u8> {
        // 繰り返しの多い中身（塊をまたぐ参照ができる）
        (0..n).map(|i| ((i as u32 / 7).wrapping_mul(seed) % 251) as u8).collect()
    }

    #[test]
    fn lists_and_extracts_in_one_pass() {
        for ctype in [cab::CompressionType::MsZip, cab::CompressionType::None] {
            let files: Vec<(String, Vec<u8>)> = (0..30).map(|i| (format!("{i}.bmp"), body(i + 3, 5000 + i as usize * 3001))).collect();
            let refs: Vec<(&str, Vec<u8>)> = files.iter().map(|(n, b)| (n.as_str(), b.clone())).collect();
            let data = make(&refs, ctype);
            let c = Cab::parse(&data).unwrap();
            assert_eq!(c.names(), files.iter().map(|f| f.0.clone()).collect::<Vec<_>>());
            let mut got = vec![];
            c.extract(&data, &mut |e, b| {
                got.push((e.name.clone(), b.to_vec()));
                Ok(())
            })
            .unwrap();
            assert_eq!(got, files, "{ctype:?}: 中身がそのまま出る（32KB をまたぐファイルも）");
            // 途中で切れた CAB
            assert!(c.extract(&data[..data.len() - 100], &mut |_, _| Ok(())).is_err());
        }
        assert!(Cab::parse(b"PK\x03\x04").is_err());
    }
}
