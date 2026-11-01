//! Python の `random.Random`（MT19937）と、試験のロットが使う Python の数の扱い（timedelta・total_seconds・`//`）をビットまで同じに再現する。
//!
//! 試験のロットの画像は乱数で作り、正解データ（desktop/tests/golden.json）は画像の中身の SHA-256 で比べる。正解データは版 3.8（Python・Flask）が
//! 版 4.8.0 までの Python の試験のロット（fixture_lot.py）に返した答えなので、乱数・時刻の丸め・割り算の丸めが 1 ビットでも違うと合わない。
//! 作り方は CPython 3.13 の `_randommodule.c`・`random.py`・`_datetimemodule.c`・`floatobject.c` に合わせた。

use sha2::{Digest, Sha512};

const N: usize = 624;

/// Python の `random.Random`。
pub struct Random {
    mt: [u32; N],
    i: usize,
}

impl Random {
    fn init_genrand(seed: u32) -> Random {
        let mut mt = [0u32; N];
        mt[0] = seed;
        for i in 1..N {
            mt[i] = 1_812_433_253u32.wrapping_mul(mt[i - 1] ^ (mt[i - 1] >> 30)).wrapping_add(i as u32);
        }
        Random { mt, i: N }
    }

    fn init_by_array(key: &[u32]) -> Random {
        let mut r = Random::init_genrand(19_650_218);
        let mt = &mut r.mt;
        let (mut i, mut j) = (1usize, 0usize);
        for _ in 0..N.max(key.len()) {
            mt[i] = (mt[i] ^ (mt[i - 1] ^ (mt[i - 1] >> 30)).wrapping_mul(1_664_525)).wrapping_add(key[j]).wrapping_add(j as u32);
            i += 1;
            j += 1;
            if i >= N {
                mt[0] = mt[N - 1];
                i = 1;
            }
            if j >= key.len() {
                j = 0;
            }
        }
        for _ in 0..N - 1 {
            mt[i] = (mt[i] ^ (mt[i - 1] ^ (mt[i - 1] >> 30)).wrapping_mul(1_566_083_941)).wrapping_sub(i as u32);
            i += 1;
            if i >= N {
                mt[0] = mt[N - 1];
                i = 1;
            }
        }
        mt[0] = 0x8000_0000;
        r
    }

    /// 大きな整数（大きい桁が先のバイト列）を種にする: 32 ビットずつ小さい桁から（CPython の random_seed）。
    fn from_big_endian(bytes: &[u8]) -> Random {
        let b: Vec<u8> = bytes.iter().copied().skip_while(|x| *x == 0).collect();
        let key: Vec<u32> =
            if b.is_empty() { vec![0] } else { b.rchunks(4).map(|c| c.iter().fold(0u32, |w, x| (w << 8) | *x as u32)).collect() };
        Random::init_by_array(&key)
    }

    /// `random.Random(整数)`（0 以上）。
    pub fn from_int(seed: u64) -> Random {
        Random::from_big_endian(&seed.to_be_bytes())
    }

    /// `random.Random(文字)`（種の作り方 2: 文字のバイトに、その SHA-512 を足した大きな整数）。
    pub fn from_text(seed: &str) -> Random {
        let mut b = seed.as_bytes().to_vec();
        b.extend_from_slice(&Sha512::digest(seed.as_bytes()));
        Random::from_big_endian(&b)
    }

    fn next_u32(&mut self) -> u32 {
        if self.i >= N {
            for k in 0..N {
                let y = (self.mt[k] & 0x8000_0000) | (self.mt[(k + 1) % N] & 0x7fff_ffff);
                self.mt[k] = self.mt[(k + 397) % N] ^ (y >> 1) ^ if y & 1 != 0 { 0x9908_b0df } else { 0 };
            }
            self.i = 0;
        }
        let mut y = self.mt[self.i];
        self.i += 1;
        y ^= y >> 11;
        y ^= (y << 7) & 0x9d2c_5680;
        y ^= (y << 15) & 0xefc6_0000;
        y ^ (y >> 18)
    }

    /// `random()`: [0, 1) の 53 ビット。
    pub fn random(&mut self) -> f64 {
        let a = (self.next_u32() >> 5) as f64;
        let b = (self.next_u32() >> 6) as f64;
        (a * 67_108_864.0 + b) / 9_007_199_254_740_992.0
    }

    /// `uniform(a, b)`。
    pub fn uniform(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.random()
    }

    /// `getrandbits(k)`（k ≤ 32）。
    fn bits(&mut self, k: u32) -> u32 {
        self.next_u32() >> (32 - k)
    }

    /// `randrange(start, stop)`（_randbelow_with_getrandbits: 桁数ぶんを引き、範囲を外れたら引き直す）。
    pub fn randrange(&mut self, start: i64, stop: i64) -> i64 {
        let n = (stop - start) as u64;
        assert!(n > 0 && n <= u32::MAX as u64, "randrange({start}, {stop})");
        let k = 64 - n.leading_zeros();
        loop {
            let r = self.bits(k) as u64;
            if r < n {
                return start + r as i64;
            }
        }
    }

    /// `randbytes(n)`（= getrandbits(n * 8).to_bytes(n, "little")）。
    pub fn randbytes(&mut self, n: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(n + 4);
        let mut left = n * 8;
        while left > 0 {
            let k = left.min(32) as u32;
            out.extend_from_slice(&self.bits(k).to_le_bytes());
            left -= k as usize;
        }
        out.truncate(n);
        out
    }
}

/// Python の `x // y`（小数。float_floor_div）。
pub fn floordiv(x: f64, y: f64) -> f64 {
    let mut m = x % y;
    let mut div = (x - m) / y;
    if m != 0.0 && ((y < 0.0) != (m < 0.0)) {
        m += y;
        div -= 1.0;
    }
    let _ = m;
    if div != 0.0 {
        let mut f = div.floor();
        if div - f > 0.5 {
            f += 1.0;
        }
        f
    } else {
        0f64.copysign(x / y)
    }
}

/// `timedelta(seconds=s)` のマイクロ秒（CPython の delta_new: 整数部 × 10^6 ＋ 小数部 × 10^6 の整数部 ＋ 残りを偶数への丸め）。
pub fn timedelta_seconds_us(s: f64) -> i64 {
    let ip = s.trunc();
    let fp = s - ip;
    let mut x = ip as i64 * 1_000_000;
    if fp == 0.0 {
        return x;
    }
    let d = fp * 1e6;
    let ip2 = d.trunc();
    let leftover = d - ip2;
    x += ip2 as i64;
    if leftover != 0.0 {
        let mut whole = leftover.round();
        if (whole - leftover).abs() == 0.5 {
            let odd = (x & 1) as f64;
            whole = 2.0 * ((leftover + odd) * 0.5).round() - odd;
        }
        x += whole as i64;
    }
    x
}

/// 整数 n ÷ d を、いちばん近い f64 に（Python の int / int。同じ近さなら仮数が偶数の方）。n・d は正。
pub fn true_div(n: i64, d: i64) -> f64 {
    assert!(n >= 0 && d > 0);
    let guess = n as f64 / d as f64;
    // 候補は guess とその両隣。誤差を整数で比べる: |m·2^e·d − n|（e ≤ 0 のとき 2^−e 倍して比べる）
    let err = |c: f64| -> (i128, bool) {
        let bits = c.to_bits();
        let exp = ((bits >> 52) & 0x7ff) as i32;
        let m = if exp == 0 { (bits & ((1 << 52) - 1)) << 1 } else { (bits & ((1 << 52) - 1)) | (1 << 52) } as i128;
        let e = exp.max(1) - 1075;
        assert!(e <= 0, "大きすぎる値");
        ((m * d as i128 - ((n as i128) << -e)).abs(), m & 1 == 0)
    };
    let cands = [f64::from_bits(guess.to_bits() - 1), guess, f64::from_bits(guess.to_bits() + 1)];
    let mut best = cands[1];
    let mut be = err(best);
    for c in [cands[0], cands[2]] {
        let ce = err(c);
        if ce.0 < be.0 || (ce.0 == be.0 && ce.1 && !be.1) {
            best = c;
            be = ce;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 値は Python 3.13 で出した物
    #[test]
    fn same_as_python() {
        let mut r = Random::from_text("2026_10_25_22_03_53");
        assert_eq!([r.random(), r.random(), r.random()], [0.4036225397168748, 0.7001597247289132, 0.29369509791371096]);
        assert_eq!(Random::from_int(5).randbytes(8), [69, 124, 118, 159, 57, 216, 100, 65]);
        assert_eq!(Random::from_int(3).randbytes(6), [253, 63, 235, 60, 183, 151], "4 の倍数でない長さ");
        assert_eq!(floordiv(1119.9999999999998, 560.0), 1.0);
        assert_eq!(timedelta_seconds_us(30.0000005), 30_000_000, "ちょうど半分は偶数へ（x = 30000000 は偶数）");
        assert_eq!(true_div(63_903_000_000_000_001, 1_000_000), 63_903_000_000.0);
    }
}
