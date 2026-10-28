use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use tauri::{Manager, WebviewWindow};

fn validate_card(filename: &str, png: &[u8]) -> Result<(), String> {
    if !filename.starts_with("numazumusic-")
        || !filename.ends_with(".png")
        || filename.len() > 180
        || !filename
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err("无效的歌词图片文件名".into());
    }
    if png.len() < 33
        || png.len() > 20 * 1024 * 1024
        || &png[..8] != b"\x89PNG\r\n\x1a\n"
        || &png[12..16] != b"IHDR"
    {
        return Err("无效的 PNG 图片".into());
    }
    let width = u32::from_be_bytes(png[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(png[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > 4096
        || height > 8000
        || u64::from(width) * u64::from(height) > 16_000_000
    {
        return Err("歌词图片尺寸超出限制".into());
    }
    Ok(())
}

fn save_in_directory(directory: &Path, filename: &str, png: &[u8]) -> Result<PathBuf, String> {
    validate_card(filename, png)?;
    let stem = filename.strip_suffix(".png").unwrap();
    for number in 0..10_000 {
        let name = if number == 0 {
            filename.to_owned()
        } else {
            format!("{stem}-{number}.png")
        };
        let path = directory.join(name);
        // create_new also refuses symlinks: an existing download is never overwritten.
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(png).and_then(|_| file.sync_all()) {
                    drop(file);
                    let _ = std::fs::remove_file(&path);
                    return Err(format!("图片写入失败：{error}"));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法保存到下载文件夹：{error}")),
        }
    }
    Err("同名图片太多，请整理下载文件夹后重试".into())
}

#[tauri::command]
pub fn save_lyric_card(
    window: WebviewWindow,
    filename: String,
    png: Vec<u8>,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("只有主播放器可以保存歌词图片".into());
    }
    let directory = window
        .app_handle()
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    save_in_directory(&directory, &filename, &png).map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_header() -> Vec<u8> {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&1200_u32.to_be_bytes());
        png.extend_from_slice(&1500_u32.to_be_bytes());
        png.resize(33, 0);
        png
    }

    #[test]
    fn rejects_paths_and_unbounded_images() {
        let mut png = png_header();
        assert!(validate_card("numazumusic-song-ja.png", &png).is_ok());
        for name in [
            "../image.png",
            "numazumusic-../image.png",
            "numazumusic-x\\image.png",
            "numazumusic-song.txt",
        ] {
            assert!(validate_card(name, &png).is_err());
        }
        assert!(validate_card("numazumusic-song.png", b"not a PNG").is_err());
        png[20..24].copy_from_slice(&9000_u32.to_be_bytes());
        assert!(validate_card("numazumusic-song.png", &png).is_err());
    }

    #[test]
    fn repeated_exports_preserve_existing_files() {
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("numazumusic-card-{}-{id}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let filename = "numazumusic-song-zh.png";
        std::fs::write(directory.join(filename), b"existing image").unwrap();
        let png = png_header();
        let first = save_in_directory(&directory, filename, &png).unwrap();
        let second = save_in_directory(&directory, filename, &png).unwrap();
        assert_ne!(first, second);
        assert_eq!(
            std::fs::read(directory.join(filename)).unwrap(),
            b"existing image"
        );
        assert_eq!(std::fs::read(first).unwrap(), png);
        assert_eq!(std::fs::read(second).unwrap(), png);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
