//! 数値の表示書式（表示項目ごとに利用者が決める。表計算と同じ書式の文字）。
//!
//! - `0` は必ず出す桁、`#` は要るときだけ出す桁（小数の後ろの `#` は、末尾の 0 を省く）
//! - `,` を整数の部分に含めば、3 桁ごとに区切る（`#,##0` → 1,070）
//! - 末尾の `%` は、100 倍して % を付ける（`0.0%` → 39.9%）
//!
//! 例: `0` → 1071・`0.00` → 1071.73・`#,##0.0` → 1,071.7・`0.###` → 0.727・`0.0%` → 39.9%
//! 書式の無い表示項目は、今までどおり（版 3.8 と同じ fmt_num・fmt_val）。画面の見本（app.js の numFmt）も同じ規則。

/// 読んだ書式。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NumFmt {
    /// 小数の、必ず出す桁の数（`0` の数）
    pub min_dec: usize,
    /// 小数の、出してよい桁の数（`0` と `#` の数）
    pub max_dec: usize,
    /// 3 桁ごとの区切り
    pub sep: bool,
    /// 百分率
    pub pct: bool,
}

/// 書式の文字を読む。数値の書式でなければ None（日時の書式〈hhmm など〉も None）。
pub fn parse(pat: &str) -> Option<NumFmt> {
    let p = pat.trim();
    let (body, pct) = match p.strip_suffix('%') {
        Some(b) => (b, true),
        None => (p, false),
    };
    if body.is_empty() || !body.chars().all(|c| matches!(c, '0' | '#' | ',' | '.')) || body.matches('.').count() > 1 {
        return None;
    }
    let (int, frac) = body.split_once('.').unwrap_or((body, ""));
    // 整数の部分は 0 か # を 1 つ以上（「.00」だけの書式は受けない）。小数の部分は 0 を先に、# を後に（「0.#0」は受けない）
    if !int.chars().any(|c| c != ',') || frac.contains(',') || frac.trim_start_matches('0').contains('0') {
        return None;
    }
    let min_dec = frac.chars().take_while(|c| *c == '0').count();
    Some(NumFmt { min_dec, max_dec: frac.len(), sep: int.contains(','), pct })
}

impl NumFmt {
    /// 数を書式に当てる。数でない（無限・NaN）物は空。
    pub fn apply(&self, x: f64) -> String {
        if !x.is_finite() {
            return String::new();
        }
        let v = if self.pct { x * 100.0 } else { x };
        let mut s = format!("{:.*}", self.max_dec, v);
        // 要るときだけ出す桁（#）の、末尾の 0 を省く
        if self.max_dec > self.min_dec {
            let keep = s.len() - (self.max_dec - self.min_dec);
            while s.len() > keep && s.ends_with('0') {
                s.pop();
            }
            if s.ends_with('.') {
                s.pop();
            }
        }
        // -0.00 のような「負の 0」は 0 にする
        if s.starts_with('-') && s[1..].chars().all(|c| c == '0' || c == '.') {
            s.remove(0);
        }
        if self.sep {
            let (sign, rest) = s.strip_prefix('-').map_or(("", s.as_str()), |r| ("-", r));
            let (int, frac) = rest.split_once('.').map_or((rest, None), |(a, b)| (a, Some(b)));
            let mut g = String::new();
            for (i, c) in int.chars().enumerate() {
                if i > 0 && (int.len() - i) % 3 == 0 {
                    g.push(',');
                }
                g.push(c);
            }
            s = format!("{sign}{g}{}", frac.map(|f| format!(".{f}")).unwrap_or_default());
        }
        if self.pct {
            s.push('%');
        }
        s
    }
}

/// 表示項目の書式（数値の書式なら）。
pub fn of_pin(p: &serde_json::Value) -> Option<NumFmt> {
    p["fmt"].as_str().and_then(parse)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(p: &str, x: f64) -> String {
        parse(p).unwrap().apply(x)
    }

    #[test]
    fn formats_like_a_spreadsheet() {
        assert_eq!(f("0", 1071.7279), "1072");
        assert_eq!(f("0.00", 1071.7279), "1071.73");
        assert_eq!(f("0.000", 3021.5), "3021.500");
        assert_eq!(f("#,##0", 5112885.94), "5,112,886");
        assert_eq!(f("#,##0.0", -1071.7279), "-1,071.7");
        assert_eq!(f("0.###", 0.7266), "0.727");
        assert_eq!(f("0.0##", 2.4), "2.4");
        assert_eq!(f("0.0##", 2.45678), "2.457");
        assert_eq!(f("0.#", 3.0), "3");
        assert_eq!(f("0.0%", 0.398936), "39.9%");
        assert_eq!(f("0.00", -0.001), "0.00", "負の 0 は出さない");
        assert_eq!(f("#,##0", 999.0), "999");
        assert_eq!(f("#,##0", -1000.0), "-1,000");
    }

    #[test]
    fn rejects_what_is_not_a_number_format() {
        for p in ["", "hhmm", "yyyymmdd", ".00", "0.0.0", "0.#0", "0,0.0,0", "abc", "%"] {
            assert_eq!(parse(p), None, "{p}");
        }
        assert_eq!(parse(" 0.00 "), Some(NumFmt { min_dec: 2, max_dec: 2, sep: false, pct: false }));
    }
}
