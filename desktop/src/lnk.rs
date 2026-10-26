//! ショートカット（.lnk）を作る・読む（Windows の部品 IShellLinkW を直に呼ぶ）と、置き場（デスクトップ・スタート）を Windows に尋ねる。
//! 何を作るか決めるのは dt_core::install。
//!
//! 試験と開発のため、置き場は環境変数 DT_LINK_DIRS（「;」区切り）で差し替えられる（そのときピン留めは見ない）。Windows 以外では
//! .lnk の代わりに指す先・作業フォルダ・アイコンを書いた小さな JSON を置く（Linux の本物の窓で決まりを通しで確かめるため。配る物は Windows だけ）。

use dt_core::install::{Link, LinkIo};
use std::path::{Path, PathBuf};

pub struct OsLinks;

/// ショートカットを置く場所（デスクトップ・スタートのプログラム）。
pub fn places() -> Vec<PathBuf> {
    if let Some(v) = std::env::var_os("DT_LINK_DIRS") {
        return std::env::split_paths(&v).filter(|p| !p.as_os_str().is_empty()).collect();
    }
    imp::places()
}

/// タスクバーのピン留めの置き場（ある物を直すだけ。作らない）。
pub fn pinned() -> Vec<PathBuf> {
    if std::env::var_os("DT_LINK_DIRS").is_some() {
        return vec![];
    }
    imp::pinned()
}

impl LinkIo for OsLinks {
    fn make(&self, link: &Path, to: &Link, description: &str) -> Result<(), String> {
        imp::make(link, to, description)
    }
    fn read(&self, link: &Path) -> Option<Link> {
        if !link.is_file() {
            return None;
        }
        imp::read(link)
    }
}

#[cfg(windows)]
mod imp {
    use dt_core::install::Link;
    use std::path::{Path, PathBuf};
    use windows::core::{Interface, HSTRING, PWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        STGM_READ,
    };
    use windows::Win32::UI::Shell::{
        FOLDERID_Desktop, FOLDERID_Programs, FOLDERID_RoamingAppData, IShellLinkW, SHChangeNotify, SHGetKnownFolderPath, ShellLink,
        KF_FLAG_DEFAULT, SHCNE_UPDATEITEM, SHCNF_PATHW,
    };

    /// COM を使えるようにして 1 件こなし、片付ける。
    fn with_link<T>(f: impl FnOnce(&IShellLinkW) -> windows::core::Result<T>) -> Result<T, String> {
        unsafe {
            let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let r = CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER).and_then(|l| f(&l));
            if init.is_ok() {
                CoUninitialize();
            }
            r.map_err(|e| e.message().to_string())
        }
    }

    /// 作って保存し、Windows（エクスプローラー・タスクバー）へ「このショートカットが変わった」と知らせる（絵を読み直させる）。
    pub fn make(link: &Path, to: &Link, description: &str) -> Result<(), String> {
        let path = HSTRING::from(link.as_os_str());
        with_link(|l| unsafe {
            l.SetPath(&HSTRING::from(to.target.as_os_str()))?;
            l.SetWorkingDirectory(&HSTRING::from(to.workdir.as_os_str()))?;
            l.SetDescription(&HSTRING::from(description))?;
            l.SetIconLocation(&HSTRING::from(to.icon.as_os_str()), 0)?;
            l.cast::<IPersistFile>()?.Save(&path, true)
        })
        .map_err(|e| format!("ショートカットを保存できません: {e}"))?;
        unsafe { SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, Some(path.as_ptr() as *const _), None) };
        Ok(())
    }

    fn text(buf: &[u16]) -> PathBuf {
        let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        PathBuf::from(String::from_utf16_lossy(&buf[..n]))
    }

    pub fn read(link: &Path) -> Option<Link> {
        with_link(|l| unsafe {
            l.cast::<IPersistFile>()?.Load(&HSTRING::from(link.as_os_str()), STGM_READ)?;
            let (mut target, mut wd, mut icon, mut index) = (vec![0u16; 32768], vec![0u16; 32768], vec![0u16; 32768], 0i32);
            l.GetPath(&mut target, std::ptr::null_mut(), 0)?;
            l.GetWorkingDirectory(&mut wd)?;
            l.GetIconLocation(&mut icon, &mut index)?;
            Ok(Link { target: text(&target), workdir: text(&wd), icon: text(&icon) })
        })
        .ok()
    }

    fn known(id: &windows::core::GUID) -> Option<PathBuf> {
        unsafe {
            let p: PWSTR = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
            let s = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as *const _));
            s.map(PathBuf::from)
        }
    }

    pub fn places() -> Vec<PathBuf> {
        [known(&FOLDERID_Desktop), known(&FOLDERID_Programs)].into_iter().flatten().collect()
    }

    pub fn pinned() -> Vec<PathBuf> {
        known(&FOLDERID_RoamingAppData)
            .map(|d| d.join("Microsoft").join("Internet Explorer").join("Quick Launch").join("User Pinned").join("TaskBar"))
            .into_iter()
            .collect()
    }
}

#[cfg(not(windows))]
mod imp {
    use dt_core::install::Link;
    use serde_json::json;
    use std::path::{Path, PathBuf};

    pub fn make(link: &Path, to: &Link, description: &str) -> Result<(), String> {
        let v = json!({"target": to.target, "workdir": to.workdir, "icon": to.icon, "description": description});
        std::fs::write(link, serde_json::to_vec(&v).unwrap_or_default()).map_err(|e| format!("ショートカットを保存できません: {e}"))
    }

    pub fn read(link: &Path) -> Option<Link> {
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(link).ok()?).ok()?;
        let path = |k: &str| v[k].as_str().map(PathBuf::from);
        Some(Link { target: path("target")?, workdir: path("workdir")?, icon: path("icon").unwrap_or_default() })
    }

    pub fn pinned() -> Vec<PathBuf> {
        vec![]
    }

    pub fn places() -> Vec<PathBuf> {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        vec![home.join("Desktop"), home.join(".local").join("share").join("applications")]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_then_read_gives_target_workdir_and_icon() {
        let dir = std::env::temp_dir().join(format!("da-lnk-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("起動 テスト.exe");
        std::fs::write(&target, "x").unwrap();
        let icon = dir.join("絵 1.ico");
        std::fs::write(&icon, "ico").unwrap();
        let link = dir.join("検査画像.lnk");
        OsLinks.make(&link, &Link { target: target.clone(), workdir: dir.clone(), icon: icon.clone() }, "説明").unwrap();
        let x = OsLinks.read(&link).unwrap();
        // 一時フォルダは 8.3 の短い名前で来ることがあり、読み戻すと長い名前になる——実際の場所で比べる
        let real = |p: &Path| std::fs::canonicalize(p).unwrap();
        assert_eq!((real(&x.target), real(&x.workdir), real(&x.icon)), (real(&target), real(&dir), real(&icon)));
        assert!(OsLinks.read(&dir.join("無い.lnk")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
