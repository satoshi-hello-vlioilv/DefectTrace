//! 作る前の準備: アイコンを描いてから Tauri の準備へ渡す。
//! アイコンの絵は `program/app/app_icon.py` の1箇所が描く（.ico をリポジトリへ置くと同じ絵が2箇所になるので、作るたびに書き出す）。
use std::path::Path;
use std::process::Command;

const DRAW: &str = "import runpy,pathlib;m=runpy.run_path('../program/app/app_icon.py');\
d=pathlib.Path('icons');d.mkdir(exist_ok=True);\
(d/'icon.ico').write_bytes(m['build']());(d/'icon.png').write_bytes(m['png'](256));\
pathlib.Path('splash/icon.png').write_bytes(m['png'](256))";

fn main() {
    // exe が名乗る「作ったコミット」。CI が渡す（desktop.yml の DT_BUILD_COMMIT）。手元で作った exe は空
    println!("cargo:rerun-if-env-changed=DT_BUILD_COMMIT");
    println!("cargo:rustc-env=DT_BUILD_COMMIT={}", std::env::var("DT_BUILD_COMMIT").unwrap_or_default());
    println!("cargo:rerun-if-changed=../program/app/app_icon.py");
    println!("cargo:rerun-if-changed=../program/app/brand.json");
    println!("cargo:rerun-if-env-changed=DT_PYTHON");
    let py = std::env::var("DT_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let ok = Command::new(&py).args(["-c", DRAW]).env("PYTHONDONTWRITEBYTECODE", "1").status().map(|s| s.success()).unwrap_or(false);
    if !ok && !(Path::new("icons/icon.ico").is_file() && Path::new("splash/icon.png").is_file()) {
        panic!("アイコンを描けません（{py} で program/app/app_icon.py を呼べません）。Python を入れるか DT_PYTHON で場所を渡してください");
    }
    tauri_build::build()
}
