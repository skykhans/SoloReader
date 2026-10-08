#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![print_document])
        .run(tauri::generate_context!())
        .expect("无法启动知页阅读器");
}
