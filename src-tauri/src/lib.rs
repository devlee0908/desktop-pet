use serde_json::Value;
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

/// The MCP server sidecar (kept so we can write inbox actions to it and kill it on exit).
struct Sidecar(Mutex<Option<CommandChild>>);
/// Last full notification list the sidecar reported, for windows that open later.
struct Notifications(Mutex<Value>);
/// Why the MCP server is down (port taken, crashed), shown in the tray; None while it runs.
struct McpError(Mutex<Option<String>>);

const TRAY_ID: &str = "pet";

/// Shows the inbox and makes the app a regular one (Dock + Cmd+Tab) while it is open.
fn show_inbox(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("inbox") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit("inbox-opened", ());
}

fn hide_inbox(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("inbox") {
        let _ = w.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

#[tauri::command]
fn open_inbox(app: AppHandle) {
    show_inbox(&app);
}

#[tauri::command]
fn inbox_state(store: State<Notifications>) -> Value {
    store.0.lock().unwrap().clone()
}

/// Forwards an inbox action ({op: "read"|"delete"|"clear", ...}) to the sidecar, the only writer.
#[tauri::command]
fn inbox_do(action: Value, sidecar: State<Sidecar>) -> Result<(), String> {
    let mut guard = sidecar.0.lock().unwrap();
    let child = guard.as_mut().ok_or("MCP sidecar is not running")?;
    child
        .write(format!("{action}\n").as_bytes())
        .map_err(|e| e.to_string())
}

/// Unread count next to the menu bar icon (macOS) and in the tooltip (everywhere; Windows has no tray title).
/// A stopped MCP server wins: "!" and the reason, so a silent failure is visible.
fn update_tray(app: &AppHandle) {
    let unread = app.state::<Notifications>().0.lock().unwrap()
        .as_array()
        .map(|a| a.iter().filter(|n| n["read"] != Value::Bool(true)).count())
        .unwrap_or(0);
    let error = app.state::<McpError>().0.lock().unwrap().clone();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let (title, tip) = match error {
            Some(e) => (Some("!".to_string()), format!("초승달 흑묘 · MCP 서버 중지됨: {e}")),
            None => (if unread > 0 { Some(unread.to_string()) } else { None }, format!("초승달 흑묘 · 안 읽은 알림 {unread}개")),
        };
        // Windows/Linux trays have no title text: show the error as a red badge on the icon instead
        #[cfg(not(target_os = "macos"))]
        let _ = tray.set_icon(tray_icon(title.as_deref() == Some("!")).ok());
        let _ = tray.set_title(title);
        let _ = tray.set_tooltip(Some(tip));
    }
}

/// The colour tray icon (non-macOS); with `alert`, a red dot in the bottom-right corner.
#[cfg(not(target_os = "macos"))]
fn tray_icon(alert: bool) -> tauri::Result<tauri::image::Image<'static>> {
    let base = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-color.png"))?;
    let (w, h) = (base.width(), base.height());
    let mut px = base.rgba().to_vec();
    if alert {
        let (cx, cy, r) = (w as f32 * 0.73, h as f32 * 0.73, w as f32 * 0.27);
        for y in 0..h {
            for x in 0..w {
                let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
                let i = ((y * w + x) * 4) as usize;
                if d <= r - 2.0 { px[i..i + 4].copy_from_slice(&[0xE0, 0x66, 0x66, 0xFF]); } // error red
                else if d <= r { px[i..i + 4].copy_from_slice(&[0, 0, 0, 0xFF]); } // black rim
            }
        }
    }
    Ok(tauri::image::Image::new_owned(px, w, h))
}

/// macOS: `visibleOnAllWorkspaces` alone keeps the pet off other apps' full-screen spaces. Adding
/// FullScreenAuxiliary lets the (floating-level) pet window show over full-screen apps too.
#[cfg(target_os = "macos")]
fn join_fullscreen_spaces(app: &AppHandle) {
    use objc2::{msg_send, runtime::AnyObject};
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0; // NSWindowCollectionBehaviorCanJoinAllSpaces
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8; // NSWindowCollectionBehaviorFullScreenAuxiliary
    let Some(win) = app.get_webview_window("main") else { return };
    let Ok(ns) = win.ns_window() else { return };
    // setup() runs on the main thread, where AppKit calls belong
    unsafe {
        let ns = ns as *mut AnyObject;
        let behavior: usize = msg_send![ns, collectionBehavior];
        let _: () = msg_send![ns, setCollectionBehavior: behavior | CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY];
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(Sidecar(Mutex::new(None)))
        .manage(Notifications(Mutex::new(Value::Array(vec![]))))
        .manage(McpError(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![open_inbox, inbox_state, inbox_do])
        .setup(|app| {
            // Hide from the Dock and Cmd+Tab (skipTaskbar only affects Windows/Linux).
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                join_fullscreen_spaces(app.handle());
            }

            // Menu bar icon (declared in tauri.conf.json): open inbox / quit.
            let open = MenuItem::with_id(app, "open", "알림함 열기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, Some("CmdOrCtrl+Q"))?;
            // Start at login: on by default for an installed (release) build, the first time it runs;
            // after that the menu item is the user's switch. Dev builds never register themselves.
            let autostart = app.autolaunch();
            #[cfg(not(debug_assertions))]
            {
                let marker = app.path().app_config_dir()?.join("autostart-initialized");
                if !marker.exists() {
                    let _ = autostart.enable();
                    std::fs::create_dir_all(marker.parent().unwrap())?;
                    std::fs::write(&marker, "")?;
                }
            }
            let login = CheckMenuItem::with_id(app, "login", "로그인 시 자동 실행", true,
                autostart.is_enabled().unwrap_or(false), None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &login, &PredefinedMenuItem::separator(app)?, &quit])?;
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                // macOS uses the black template icon from tauri.conf.json (it adapts to the menu bar);
                // elsewhere a white head with a black rim reads on light and dark taskbars.
                #[cfg(not(target_os = "macos"))]
                tray.set_icon(Some(tray_icon(false)?))?;
                tray.set_menu(Some(menu))?;
                tray.on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => show_inbox(app),
                    "login" => {
                        let a = app.autolaunch();
                        let _ = if a.is_enabled().unwrap_or(false) { a.disable() } else { a.enable() };
                        let _ = login.set_checked(a.is_enabled().unwrap_or(false));
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            }

            // MCP server: one JSON object per stdout line → "pet-mcp" event for every window.
            let (mut rx, child) = app.shell().sidecar("pet-mcp")?.spawn()?;
            *app.state::<Sidecar>().0.lock().unwrap() = Some(child);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => match serde_json::from_slice::<Value>(&line) {
                            Ok(msg) => {
                                if msg["type"] == "state" {
                                    *handle.state::<Notifications>().0.lock().unwrap() = msg["notifications"].clone();
                                    update_tray(&handle);
                                } else if msg["type"] == "error" {
                                    *handle.state::<McpError>().0.lock().unwrap() = msg["message"].as_str().map(String::from);
                                    update_tray(&handle);
                                }
                                let _ = handle.emit("pet-mcp", msg);
                            }
                            Err(_) => eprintln!("[pet-mcp] {}", String::from_utf8_lossy(&line).trim_end()),
                        },
                        CommandEvent::Stderr(line) => eprintln!("{}", String::from_utf8_lossy(&line).trim_end()),
                        CommandEvent::Terminated(p) => {
                            eprintln!("[pet-mcp] exited with {:?}", p.code);
                            handle.state::<McpError>().0.lock().unwrap()
                                .get_or_insert_with(|| format!("종료됨 (코드 {:?})", p.code));
                            update_tray(&handle);
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the inbox only hides it (and takes the app back out of the Dock).
            if let (WindowEvent::CloseRequested { api, .. }, "inbox") = (event, window.label()) {
                api.prevent_close();
                hide_inbox(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Dock icon clicked while the inbox is hidden behind other windows
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_inbox(app),
            RunEvent::Exit => {
                if let Some(child) = app.state::<Sidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
            _ => {}
        });
}
