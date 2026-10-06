#[tauri_runtime_cef::cef_entry_point]
fn main() {
    tauri::Builder::default()
        .runtime(tauri_runtime_cef::Cef::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Excalidraw Desktop");
}
