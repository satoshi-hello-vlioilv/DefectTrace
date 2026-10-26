//! 値の書き方（版 3.8 までの Python 版と同じ字にする。画面・CSV・試験の正解データが同じ字を見る）。
//!
//! - `round_to`: Python の `round(x, n)`（2 進の値を正しく丸める。Rust の `{:.n}` も同じ丸め方）
//! - `fmt_float`: 小数 3 桁で書き、後ろの 0 と点を落とす（1e7 以上は有効 6 桁）
//! - `natcmp`: 数字の並びを数として比べる名前の並び（0002.cab < 0010.cab・2.bmp < 10.bmp）

use std::cmp::Ordering;

/// Python の `round(x, n)`。
pub fn round_to(x: f64, n: usize) -> f64 {
    if !x.is_finite() {
        return x;
    }
    format!("{x:.n$}").parse().unwrap_or(x)
}

/// Python の `f"{x:.{n}f}"`。
pub fn fixed(x: f64, n: usize) -> String {
    format!("{x:.n$}")
}

/// Python の `f"{x:.6g}"`（有効 6 桁・指数は e+XX）。
pub fn general6(x: f64) -> String {
    if x == 0.0 {
        return "0".into();
    }
    if !x.is_finite() {
        return if x.is_nan() {
            "nan".into()
        } else if x > 0.0 {
            "inf".into()
        } else {
            "-inf".into()
        };
    }
    let e = format!("{x:.5e}");
    let (mant, exp) = e.split_once('e').unwrap_or((&e, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    if (-4..6).contains(&exp) {
        let digits = (5 - exp).max(0) as usize;
        trim_zeros(&format!("{x:.digits$}"))
    } else {
        let m = trim_zeros(mant);
        format!("{m}e{}{:02}", if exp < 0 { '-' } else { '+' }, exp.abs())
    }
}

fn trim_zeros(s: &str) -> String {
    if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    } else {
        s.to_string()
    }
}

/// 版 3.8 の fmt_val の小数: 3 桁で書き、後ろの 0 と点を落とす。1e7 以上は有効 6 桁。
pub fn fmt_float(v: f64) -> String {
    if v.abs() < 1e7 {
        trim_zeros(&fixed(v, 3))
    } else {
        general6(v)
    }
}

/// Python の `str(float)`（repr。整数の値でも .0 を付ける）。
pub fn py_repr(v: f64) -> String {
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 1e16 {
        return format!("{v:.1}");
    }
    let s = format!("{v}");
    if v.is_finite() && (v.abs() >= 1e16 || (v != 0.0 && v.abs() < 1e-4)) {
        // Rust は 1e16 を 10000000000000000 と書くので、Python と同じ指数の形にする
        let e = format!("{v:e}");
        if let Some((m, x)) = e.split_once('e') {
            let x: i32 = x.parse().unwrap_or(0);
            return format!("{m}e{}{:02}", if x < 0 { '-' } else { '+' }, x.abs());
        }
    }
    s
}

/// 数字の並びを数として比べる（Python の natkey: 数字は数、ほかは小文字で）。
pub fn natcmp(a: &str, b: &str) -> Ordering {
    let (ka, kb) = (natkey(a), natkey(b));
    for (x, y) in ka.iter().zip(kb.iter()) {
        let o = match (x, y) {
            (Part::Num(p), Part::Num(q)) => p.cmp(q),
            (Part::Text(p), Part::Text(q)) => p.cmp(q),
            (Part::Num(_), Part::Text(_)) => Ordering::Less,
            (Part::Text(_), Part::Num(_)) => Ordering::Greater,
        };
        if o != Ordering::Equal {
            return o;
        }
    }
    ka.len().cmp(&kb.len())
}

#[derive(Debug, PartialEq)]
enum Part {
    Num(u128),
    Text(String),
}

/// Python の `re.split(r"(\d+)", s)`: 文字・数・文字… の順（最初と最後は空の文字もある）。
fn natkey(s: &str) -> Vec<Part> {
    let mut out = vec![];
    let mut text = String::new();
    let mut num = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() {
            num.push(c);
        } else {
            if !num.is_empty() {
                out.push(Part::Text(std::mem::take(&mut text).to_lowercase()));
                out.push(Part::Num(num.parse().unwrap_or(u128::MAX)));
                num.clear();
            }
            text.push(c);
        }
    }
    if !num.is_empty() {
        out.push(Part::Text(std::mem::take(&mut text).to_lowercase()));
        out.push(Part::Num(num.parse().unwrap_or(u128::MAX)));
    }
    out.push(Part::Text(text.to_lowercase()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floats_are_written_like_python() {
        assert_eq!(fmt_float(2.5), "2.5");
        assert_eq!(fmt_float(3.0), "3");
        assert_eq!(fmt_float(-0.0004), "-0");
        assert_eq!(fmt_float(1234.5678), "1234.568");
        assert_eq!(fmt_float(12345678.9), "1.23457e+07");
        assert_eq!(general6(0.000012345), "1.2345e-05");
        assert_eq!(general6(123456.0), "123456");
        assert_eq!(round_to(2.675, 2), 2.67, "2 進の値で丸める（Python と同じ）");
        assert_eq!(round_to(0.125, 2), 0.12, "ちょうど半分は偶数へ");
        assert_eq!(py_repr(1.0), "1.0");
        assert_eq!(py_repr(0.1), "0.1");
        assert_eq!(py_repr(1e16), "1e+16");
    }

    #[test]
    fn names_sort_by_number() {
        let mut v = vec!["10.bmp", "2.bmp", "B.cab", "a10", "a9", "0002"];
        v.sort_by(|a, b| natcmp(a, b));
        assert_eq!(v, ["0002", "2.bmp", "10.bmp", "a9", "a10", "B.cab"]);
    }
}
