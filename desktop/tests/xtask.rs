//! 作業用の道具（xtask）が作る配る形を、窓（dt_core）の本物の読み方で読めるか（道具と窓の食い違いを止める）。
//! - 配る ZIP の中身（配る形）を、更新の係（update::validate_dist）が受け取る
//! - 版 4.8.0 までの窓は配る形の版を program/app/version.py で確かめる: version.json が無くても、道具が作った写しで同じ版が読める
//! - release.json を、置き場の係（release::read_release）が同じ値で読む

use dt_core::{release, update};
use std::path::Path;

#[test]
fn the_window_reads_what_xtask_builds() {
    let out = std::env::temp_dir().join(format!("dt-xtask-built-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    std::fs::create_dir_all(&out).unwrap();
    let exe = out.join("built.exe");
    std::fs::write(&exe, b"MZ").unwrap();
    let built = xtask::bundle::build(&exe, &out.join("release")).unwrap();
    let rel = &built.release;
    let want = xtask::version::read(&xtask::version::program()).unwrap().version;
    assert_eq!(rel.version, want);

    // 配る形を、更新の係が受け取る（新しい窓: version.json）
    assert_eq!(update::validate_dist(&built.stage, &rel.exe, &rel.app_id, Some(&want)), Ok(want.clone()));
    // 古い窓の読み方（version.py の 1 行）でも同じ版
    let legacy = built.stage.join("program").join("app").join("version.py");
    assert!(legacy.is_file(), "古い窓のための version.py を配る形に入れる");
    std::fs::remove_file(built.stage.join("program").join("app").join("version.json")).unwrap();
    assert_eq!(update::program_version(&built.stage.join("program")), Some(want.clone()), "version.py の写しで読める");

    // release.json を、置き場の係が同じ値で読む
    let read = release::read_release(&out.join("release"), &rel.app_id).unwrap().expect("このアプリの release.json");
    assert_eq!(
        (read.version.as_str(), read.zip.as_str(), read.sha256.as_str(), read.exe.as_str()),
        (want.as_str(), rel.zip.as_str(), rel.sha256.as_str(), rel.exe.as_str())
    );
    assert!(Path::new(&built.path).is_file());
    let _ = std::fs::remove_dir_all(&out);
}
