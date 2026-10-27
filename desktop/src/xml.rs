//! 検査計の XML を読む: 文字コード（Shift_JIS など）に寛容に読み、(鍵, 値) の並びに平らにする。
//! 鍵の形は `condition/group_conditions/group[1]/disp_name@value`（同じ名前が 2 つ以上なら [番号]）。
//! 定義ファイル（*Def.xml）の注釈（<!-- -->）は、項目の名前（ラベル）に使う。

use crate::cache::Lru;
use regex::Regex;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, OnceLock};

pub type Pairs = Arc<Vec<(String, String)>>;

/// XML の文字を読む（宣言の encoding に従う。読めなければ Shift_JIS〔cp932〕で置き換えながら）。宣言は外す。
pub fn decode(data: &[u8]) -> String {
    let head = &data[..data.len().min(200)];
    let enc = Regex::new(r#"encoding=["']([\w\-]+)["']"#)
        .ok()
        .and_then(|r| r.captures(&String::from_utf8_lossy(head)).map(|c| c[1].to_ascii_lowercase()))
        .unwrap_or_else(|| "utf-8".into());
    let label = if matches!(enc.as_str(), "shift_jis" | "shift-jis" | "sjis" | "x-sjis" | "cp932") { "shift_jis" } else { enc.as_str() };
    let text = match encoding_rs::Encoding::for_label(label.as_bytes()) {
        Some(e) => {
            let (t, _, bad) = e.decode(data);
            if bad {
                encoding_rs::SHIFT_JIS.decode(data).0.into_owned()
            } else {
                t.into_owned()
            }
        }
        None => encoding_rs::SHIFT_JIS.decode(data).0.into_owned(),
    };
    static DECL: OnceLock<Regex> = OnceLock::new();
    let decl = DECL.get_or_init(|| Regex::new(r"^\u{feff}?\s*<\?xml[^>]*\?>").unwrap());
    decl.replace(&text, "").into_owned()
}

fn tag<'a>(n: &roxmltree::Node<'a, '_>) -> &'a str {
    n.tag_name().name()
}

/// `[番号]` を外した鍵（繰り返しをまとめた形）。
pub fn norm(path: &str) -> String {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\[\d+\]").unwrap()).replace_all(path, "").into_owned()
}

/// 平らにする（Python 版の _walk と同じ順と形）。comments を渡すと、値の代わりに注釈を集める。
fn walk(el: roxmltree::Node, p: &str, out: &mut Vec<(String, String)>, limit: usize, comments: Option<&mut HashMap<String, String>>) {
    let collecting = comments.is_some();
    if !collecting {
        for a in el.attributes() {
            out.push((format!("{p}@{}", a.name()), a.value().to_string()));
        }
        let has_kids = el.children().any(|c| c.is_element());
        if !has_kids {
            let txt: String = el.children().filter(|c| c.is_text()).filter_map(|c| c.text()).collect();
            let txt = txt.trim();
            if !txt.is_empty() {
                out.push((p.to_string(), txt.to_string()));
            }
        }
    }
    let mut cnt: HashMap<&str, usize> = HashMap::new();
    for c in el.children().filter(|c| c.is_element()) {
        *cnt.entry(tag(&c)).or_default() += 1;
    }
    let mut idx: HashMap<&str, usize> = HashMap::new();
    let mut last_comment: Option<String> = None;
    let mut comments = comments;
    for c in el.children() {
        if out.len() >= limit {
            return;
        }
        if c.is_comment() {
            last_comment = Some(c.text().unwrap_or("").trim().to_string());
            continue;
        }
        if !c.is_element() {
            continue;
        }
        let t = tag(&c);
        let cp = if cnt[t] > 1 {
            let i = idx.entry(t).or_default();
            let s = format!("{p}/{t}[{i}]");
            *i += 1;
            s
        } else {
            format!("{p}/{t}")
        };
        if let (Some(m), Some(lc)) = (comments.as_deref_mut(), last_comment.as_ref()) {
            if !lc.is_empty() {
                m.entry(cp.clone()).or_insert_with(|| lc.clone());
                m.entry(norm(&cp)).or_insert_with(|| lc.clone());
            }
        }
        last_comment = None;
        walk(c, &cp, out, limit, comments.as_deref_mut());
    }
}

fn parse_pairs(data: &[u8], limit: usize) -> Vec<(String, String)> {
    let text = decode(data);
    let opt = roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() };
    match roxmltree::Document::parse_with_options(&text, opt) {
        Ok(doc) => {
            let root = doc.root_element();
            let mut out = vec![];
            walk(root, tag(&root), &mut out, limit, None);
            out
        }
        Err(e) => vec![("(parse error)".into(), e.to_string())],
    }
}

type Key = (String, u128, u64);

fn file_key(path: &Path) -> Option<Key> {
    let m = std::fs::metadata(path).ok()?;
    let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    Some((path.display().to_string(), t, m.len()))
}

/// (鍵, 値) の組のメモリのだいたいの大きさ（覚えの重さ）。
fn weight<'a>(kv: impl Iterator<Item = (&'a String, &'a String)>) -> usize {
    kv.map(|(k, v)| 48 + k.capacity() + v.capacity()).sum()
}

/// XML の覚え（(鍵, 値) の組・定義の名前）の上限。ロットごとに条件の XML があるので、数千ロットを読んでも増え続けないように
const XML_CACHE_BYTES: usize = 96 << 20;

/// XML を (鍵, 値) に平らにする（6000 組まで）。ファイルの大きさ・更新時刻で覚える。
pub fn pairs(path: &Path) -> Pairs {
    static CACHE: OnceLock<Lru<Key, Pairs>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Lru::new(XML_CACHE_BYTES));
    let Some(k) = file_key(path) else { return Arc::new(vec![]) };
    if let Some(v) = cache.get(&k) {
        return v;
    }
    let v = Arc::new(match std::fs::read(path) {
        Ok(b) => parse_pairs(&b, 6000),
        Err(e) => vec![("(parse error)".into(), e.to_string())],
    });
    let w = weight(v.iter().map(|(a, b)| (a, b)));
    cache.insert(k, v, w)
}

/// 注釈を項目の名前らしく短くする（Python 版の clean_label と同じ）。
pub fn clean_label(c: &str) -> String {
    static R: OnceLock<[Regex; 5]> = OnceLock::new();
    let r = R.get_or_init(|| {
        [
            Regex::new(r"(?i)comment\s*\d+").unwrap(),
            Regex::new(r"(?i)\bfor\b.*$").unwrap(),
            Regex::new(r"//.*$").unwrap(),
            Regex::new(r"[（(].*?[)）]").unwrap(),
            Regex::new(r"\s{2,}|\n").unwrap(),
        ]
    });
    let mut s = c.to_string();
    for re in &r[..4] {
        s = re.replace_all(&s, "").into_owned();
    }
    let s = s.replace("--", " ");
    let s = s.trim();
    let first = r[4].split(s).next().unwrap_or("").trim();
    first.chars().take(24).collect()
}

/// 定義ファイルの注釈 → 鍵ごとの名前（覚える）。
pub fn def_labels(path: &Path) -> Arc<HashMap<String, String>> {
    static CACHE: OnceLock<Lru<Key, Arc<HashMap<String, String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Lru::new(XML_CACHE_BYTES / 4));
    let Some(k) = file_key(path) else { return Arc::default() };
    if let Some(v) = cache.get(&k) {
        return v;
    }
    let mut raw = HashMap::new();
    if let Ok(b) = std::fs::read(path) {
        let text = decode(&b);
        let opt = roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() };
        if let Ok(doc) = roxmltree::Document::parse_with_options(&text, opt) {
            let root = doc.root_element();
            walk(root, tag(&root), &mut vec![], usize::MAX, Some(&mut raw));
        }
    }
    let m: HashMap<String, String> = raw.into_iter().map(|(k, v)| (k, clean_label(&v))).filter(|(_, v)| !v.is_empty()).collect();
    let w = weight(m.iter());
    cache.insert(k, Arc::new(m), w)
}

/// 鍵の名前（定義の注釈）。属性が value 以外なら @属性 を添える。
pub fn label_for(key: &str, labels: &HashMap<String, String>) -> String {
    if labels.is_empty() {
        return String::new();
    }
    let (el, attr) = key.split_once('@').unwrap_or((key, ""));
    for k in [el.to_string(), norm(el)] {
        if let Some(l) = labels.get(&k) {
            return if attr.is_empty() || attr == "value" { l.clone() } else { format!("{l}@{attr}") };
        }
    }
    String::new()
}

/// 表示の鍵（[*] は「どの番号でも・番号なしでも」）に合う値を集める。
pub fn match_values(pairs: &[(String, String)], key: &str) -> Vec<String> {
    let pat = format!("^{}$", regex::escape(key).replace(r"\[\*\]", r"(?:\[\d+\])?"));
    let Ok(rx) = Regex::new(&pat) else { return vec![] };
    pairs.iter().filter(|(k, _)| rx.is_match(k)).map(|(_, v)| v.trim().to_string()).collect()
}

/// ファイルの相対パスを、番号を * にした形に（同じ種類のファイルをまとめる）。
pub fn generalize(rel: &str) -> String {
    static D: OnceLock<Regex> = OnceLock::new();
    static S: OnceLock<Regex> = OnceLock::new();
    let rel = rel.replace('\\', "/");
    let (d, f) = rel.rsplit_once('/').map(|(a, b)| (a.to_string(), b.to_string())).unwrap_or((String::new(), rel.clone()));
    let f = D.get_or_init(|| Regex::new(r"\d+").unwrap()).replace_all(&f, "*");
    let f = S.get_or_init(|| Regex::new(r"\*+").unwrap()).replace_all(&f, "*");
    if d.is_empty() {
        f.into_owned()
    } else {
        format!("{d}/{f}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flattens_with_indexes_text_and_sjis() {
        let (xml, _, _) = encoding_rs::SHIFT_JIS.encode(
            "<?xml version=\"1.0\" encoding=\"Shift_JIS\"?><c><h><n value=\"条件\"/></h><g><d value=\"表面\"/></g><g><d value=\"裏面\"/><t> 文 </t></g></c>",
        );
        let p = parse_pairs(&xml, 100);
        assert_eq!(
            p,
            [("c/h/n@value", "条件"), ("c/g[0]/d@value", "表面"), ("c/g[1]/d@value", "裏面"), ("c/g[1]/t", "文")]
                .map(|(a, b)| (a.to_string(), b.to_string()))
        );
        assert_eq!(match_values(&p, "c/g[*]/d@value"), ["表面", "裏面"]);
        assert_eq!(norm("a/b[3]/c[10]"), "a/b/c");
        assert_eq!(parse_pairs(b"<a><b>", 10)[0].0, "(parse error)");
    }

    #[test]
    fn labels_are_cleaned() {
        assert_eq!(clean_label("Comment 1 検査長 for length"), "検査長");
        assert_eq!(clean_label("幅（mm） // 予備"), "幅");
        assert_eq!(clean_label("A--B  C"), "A B");
        assert_eq!(generalize("img\\0012.cab"), "img/*.cab");
        assert_eq!(generalize("COND01_02.xml"), "COND*_*.xml");
    }
}
