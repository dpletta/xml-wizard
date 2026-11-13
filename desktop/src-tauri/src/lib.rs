//! XML Wizard desktop shell.
//!
//! The app is a local web page in the system web view. These few commands are
//! its only way to touch the disk: read a file the person picked, and write
//! files to a place the person picked. There is no network code.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Deserialize;

/// Read a REDCap export as text. REDCap files are UTF-8, but data dictionaries
/// saved from Excel on Windows are often Windows-1252, so fall back to reading
/// each byte as one character instead of failing.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    Ok(match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    })
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Could not save {path}: {e}"))
}

#[derive(Deserialize)]
struct BundleFile {
    path: String,
    contents: String,
}

/// A path inside the chosen folder: relative, with no `..` and no drive or root.
fn safe_join(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel.is_empty() || !rel_path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("Refusing to write outside the chosen folder: {rel}"));
    }
    Ok(dir.join(rel_path))
}

/// Write a set of text files (the agent bundle) under one folder.
#[tauri::command]
fn write_files(dir: String, files: Vec<BundleFile>) -> Result<usize, String> {
    let dir = PathBuf::from(dir);
    for file in &files {
        let target = safe_join(&dir, &file.path)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
        }
        fs::write(&target, &file.contents).map_err(|e| format!("Could not save {}: {e}", target.display()))?;
    }
    Ok(files.len())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_text_file, write_text_file, write_files])
        .run(tauri::generate_context!())
        .expect("error while running XML Wizard");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_paths_stay_inside_the_folder() {
        let dir = Path::new("/tmp/out");
        assert!(safe_join(dir, "agent_bundle/AGENTS.md").is_ok());
        assert!(safe_join(dir, "../secrets").is_err());
        assert!(safe_join(dir, "/etc/passwd").is_err());
        assert!(safe_join(dir, "a/../../b").is_err());
        assert!(safe_join(dir, "").is_err());
    }

    #[test]
    fn files_are_written_and_read_back() {
        let dir = std::env::temp_dir().join(format!("xmlw-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let files = vec![
            BundleFile { path: "agent_bundle/AGENTS.md".into(), contents: "# Hello".into() },
            BundleFile { path: "survey_tree.html".into(), contents: "<html>é</html>".into() },
        ];
        assert_eq!(write_files(dir.to_string_lossy().into_owned(), files).unwrap(), 2);
        let back = read_text_file(dir.join("agent_bundle").join("AGENTS.md").to_string_lossy().into_owned()).unwrap();
        assert_eq!(back, "# Hello");
        let outside = vec![BundleFile { path: "../escape.txt".into(), contents: String::new() }];
        assert!(write_files(dir.to_string_lossy().into_owned(), outside).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn windows_1252_files_open_instead_of_failing() {
        let path = std::env::temp_dir().join(format!("xmlw-cp1252-{}.csv", std::process::id()));
        fs::write(&path, [0xEF, 0xBB, 0xBF, b'a', b',', 0xE9]).unwrap_or(());
        // With a UTF-8 byte order mark but an invalid tail, each byte becomes one character.
        assert_eq!(read_text_file(path.to_string_lossy().into_owned()).unwrap(), "a,\u{e9}");
        fs::remove_file(&path).unwrap();
    }
}
