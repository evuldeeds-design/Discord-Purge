mod auth; // Declare the auth module

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init()) // Initialize the shell plugin
        .plugin(tauri_plugin_opener::init()) // Initialize the opener plugin
        .invoke_handler(tauri::generate_handler![auth::start_oauth_flow]) // Register the new OAuth flow command
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}