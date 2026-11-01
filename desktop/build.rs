//! 作る前の準備: アイコンを描いてから Tauri の準備へ渡す。
//! アイコンの絵は作業用の道具 `xtask/src/icon.rs` の 1 箇所が描く（.ico をリポジトリへ置くと同じ絵が 2 箇所になるので、作るたびに書き出す）。
use std::path::Path;

/// 中身が違うときだけ書く（同じ物を書き直すと、Tauri の準備が変わったと見て作り直しが続く）
fn write_if_changed(path: &str, body: &[u8]) {
    let p = Path::new(path);
    if std::fs::read(p).ok().as_deref() != Some(body) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap_or_else(|e| panic!("{path}: {e}"));
        std::fs::write(p, body).unwrap_or_else(|e| panic!("アイコンを書けません（{path}）: {e}"));
    }
}

fn main() {
    // exe が名乗る「作ったコミット」。CI が渡す（desktop.yml の DT_BUILD_COMMIT）。手元で作った exe は空
    println!("cargo:rerun-if-env-changed=DT_BUILD_COMMIT");
    println!("cargo:rustc-env=DT_BUILD_COMMIT={}", std::env::var("DT_BUILD_COMMIT").unwrap_or_default());
    println!("cargo:rerun-if-changed=../program/app/brand.json");
    let png = xtask::icon::png(256);
    write_if_changed("icons/icon.ico", &xtask::icon::ico());
    write_if_changed("icons/icon.png", &png);
    write_if_changed("splash/icon.png", &png);
    tauri_build::build()
}
