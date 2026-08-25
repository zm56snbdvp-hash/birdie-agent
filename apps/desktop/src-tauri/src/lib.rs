use tauri::{Manager, menu::{Menu, MenuItem}, tray::TrayIconBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
      if let Some(window) = app.get_webview_window("core") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .setup(|app| {
      let show = MenuItem::with_id(app, "show", "Birdie anzeigen", true, None::<&str>)?;
      let hide = MenuItem::with_id(app, "hide", "Birdie verbergen", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Birdie beenden", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
      TrayIconBuilder::new().menu(&menu).on_menu_event(|app, event| {
        match event.id.as_ref() {
          "show" => if let Some(w) = app.get_webview_window("core") { let _ = w.show(); },
          "hide" => if let Some(w) = app.get_webview_window("core") { let _ = w.hide(); },
          "quit" => app.exit(0),
          _ => {}
        }
      }).build(app)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("Birdie desktop runtime failed");
}
