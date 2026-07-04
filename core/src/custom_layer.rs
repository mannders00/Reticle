// core/src/custom_layer.rs
// Loads a user-declared custom layer file (GeoJSON, JSON, or any text the
// frontend can parse) for the canvas. Server-map kept arbitrary layer
// sources this way; we honour the same UX without bundling a mapping
// library — the canvas just draws what the user supplies.

use std::fs;
use std::path::PathBuf;

use shellexpand::tilde;

pub fn load(file: &str, config_dir: &str) -> Result<String, String> {
    let expanded = tilde(file).to_string();
    let path = if expanded.starts_with('/') {
        PathBuf::from(&expanded)
    } else {
        PathBuf::from(config_dir).join(&expanded)
    };
    fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {}", path.display(), e))
}