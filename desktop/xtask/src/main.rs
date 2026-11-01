//! 作る・配る・試すための作業用の道具の入口。desktop の下で `cargo xtask <仕事>` と打つ（.cargo/config.toml の別名）。

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use xtask::{bundle, fixture, selftest, verify, version};

const HELP: &str = "使い方: cargo xtask <仕事>（desktop の下で）

試す
  fixture <作る場所>                               試験のロット（正解データ用の小さな木・3 ロット）
  fixture <作る場所> --bench <N> <W> <H>           速さを測る大きなロット（CAB N 個 × 100 枚・W×H の BMP）
  fixture <作る場所> --dl2 <名前> [--eq <設備>] [--max-status <0|1>]   画像なしのロットを 1 つ
  selftest-config <試験のロット> <作業場所> [<更新の置き場>]   自己診断の設定（作業場所の config.json）
  selftest-report <結果の JSON>                    自己診断の結果を PASS/FAIL で出す（通らなければ終了コード 1）
  verify-update --exe <exe> [--work <作業フォルダ>] [--keep]   本物の窓で更新の通しを流す

版
  version                                          アプリの版（program/app/version.json）
  digest                                           配る物の中身の要約
  release [--amend]                                版を上げたあと、version.json の release を書く

配る
  brand <項目>                                     名前の定義（program/app/brand.json）の値
  bundle --exe <exe> --out <出力先>                配る ZIP・release.json・.sha256
  notes --release <release.json> [--out <ファイル>]  GitHub Releases の説明（--out は UTF-8 で書く。無ければ画面へ）";

/// --名前 の次の値
fn opt(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn need(args: &[String], name: &str) -> Result<String, String> {
    opt(args, name).ok_or_else(|| format!("{name} が要ります\n\n{HELP}"))
}

fn arg(args: &[String], i: usize) -> Result<&str, String> {
    args.get(i).map(String::as_str).filter(|a| !a.starts_with("--")).ok_or_else(|| HELP.to_string())
}

fn num(s: &str) -> Result<usize, String> {
    s.parse().map_err(|_| format!("数ではありません: {s}"))
}

fn run(args: &[String]) -> Result<bool, String> {
    let program = version::program();
    match args.first().map(String::as_str) {
        Some("fixture") => {
            let root = PathBuf::from(arg(args, 1)?);
            let lots = if let Some(i) = args.iter().position(|a| a == "--bench") {
                let n: Vec<usize> =
                    (1..=3).map(|k| args.get(i + k).ok_or(HELP.to_string()).and_then(|s| num(s))).collect::<Result<_, _>>()?;
                vec![fixture::bench_lot(&root, n[0], n[1], n[2])]
            } else if let Some(name) = opt(args, "--dl2") {
                let eq = opt(args, "--eq").unwrap_or_else(|| "DL2".into());
                let max = opt(args, "--max-status").map(|s| num(&s)).transpose()?.unwrap_or(1);
                vec![fixture::make_dl2(&root, &name, &eq, max as i64)]
            } else {
                fixture::golden_tree(&root)
            };
            lots.iter().for_each(|p| println!("{}", p.display()));
        }
        Some("selftest-config") => {
            let p = selftest::write_config(Path::new(arg(args, 1)?), Path::new(arg(args, 2)?), args.get(3).map(String::as_str))?;
            println!("{}", p.display());
        }
        Some("selftest-report") => return selftest::report(Path::new(arg(args, 1)?)),
        Some("verify-update") => {
            let exe = std::path::absolute(need(args, "--exe")?).map_err(|e| e.to_string())?;
            let work = opt(args, "--work").map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("dt-verify"));
            let work = std::path::absolute(work).map_err(|e| e.to_string())?;
            let ok = verify::update(&exe, &work)?;
            if ok && !args.iter().any(|a| a == "--keep") {
                let _ = std::fs::remove_dir_all(&work);
            }
            println!("{}", if ok { "OK" } else { "FAILED" });
            return Ok(ok);
        }
        Some("version") => println!("{}", version::read(&program)?.version),
        Some("digest") => {
            let files = version::release_files(&program);
            println!("配る物の要約 {}（{} ファイル）", version::release_digest(&program), files.len());
        }
        Some("release") => println!("{}", version::record_release(&program, args.iter().any(|a| a == "--amend"))?),
        Some("brand") => {
            let b = bundle::brand(&program)?;
            let key = arg(args, 1)?;
            let v = b.get(key).ok_or_else(|| format!("brand.json に {key} がありません"))?;
            println!("{}", selftest::info(v));
        }
        Some("bundle") => {
            let built = bundle::build(Path::new(&need(args, "--exe")?), Path::new(&need(args, "--out")?))?;
            print!("{}", bundle::pretty(&built));
        }
        Some("notes") => {
            let p = need(args, "--release")?;
            let rel: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&p).map_err(|e| format!("{p}: {e}"))?).map_err(|e| e.to_string())?;
            let b = bundle::brand(&program)?;
            let s = |k: &str| rel[k].as_str().unwrap_or_default().to_string();
            let mut r = bundle::release_json(&b, &s("version"), &s("zip"), &s("sha256"))?;
            r.app_id = s("app_id");
            let notes = bundle::release_notes(&r, &version::read(&program)?.changelog)?;
            match opt(args, "--out") {
                Some(out) => std::fs::write(&out, notes).map_err(|e| format!("{out}: {e}"))?,
                None => print!("{notes}"),
            }
        }
        _ => {
            println!("{HELP}");
            return Ok(args.is_empty());
        }
    }
    Ok(true)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
