#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lyric_card;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{Emitter, Manager, State, WebviewWindow};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Subtitle {
    title: String,
    japanese: String,
    translation: String,
    playing: bool,
    ready: bool,
    can_previous: bool,
    can_next: bool,
    error: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum PlaybackAction {
    Previous,
    Next,
    Toggle,
}

#[tauri::command]
fn control_playback(window: WebviewWindow, action: PlaybackAction) -> Result<(), String> {
    if window.label() != "lyrics" {
        return Err("Only the subtitle window may send playback controls".into());
    }
    window
        .emit_to("main", "player-command", action)
        .map_err(|e| e.to_string())
}

#[derive(Clone, Default, Serialize)]
struct OverlayStatus {
    visible: bool,
    locked: bool,
}

#[derive(Default)]
struct DesktopState {
    subtitle: Mutex<Subtitle>,
    status: Mutex<OverlayStatus>,
}

#[cfg(target_os = "macos")]
struct LyricsMenu {
    visible: CheckMenuItem<tauri::Wry>,
    unlock: MenuItem<tauri::Wry>,
}

fn sync_lyrics_menu(_app: &tauri::AppHandle, _status: &OverlayStatus) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if let Some(menu) = _app.try_state::<LyricsMenu>() {
        menu.visible
            .set_checked(_status.visible)
            .map_err(|e| e.to_string())?;
        menu.unlock
            .set_enabled(_status.visible && _status.locked)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn setup_lyrics_menu(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Extend the standard View menu, preserving native editing/window shortcuts.
    let menu = Menu::default(app.handle())?;
    let visible =
        CheckMenuItem::with_id(app, "lyrics-visible", "悬浮歌词", true, false, None::<&str>)?;
    let unlock = MenuItem::with_id(app, "lyrics-unlock", "解锁悬浮歌词", false, None::<&str>)?;
    let view = menu
        .items()?
        .into_iter()
        .find_map(|item| {
            item.as_submenu()
                .filter(|submenu| submenu.text().ok().as_deref() == Some("View"))
                .cloned()
        })
        .ok_or("Missing standard View menu")?;
    view.set_text("显示")?;
    view.append_items(&[&PredefinedMenuItem::separator(app)?, &visible, &unlock])?;
    app.manage(LyricsMenu { visible, unlock });
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let result = match event.id().as_ref() {
            "lyrics-visible" => overlay_status(app.state())
                .and_then(|status| set_overlay_visible(app.clone(), app.state(), !status.visible)),
            "lyrics-unlock" => set_overlay_locked(app.clone(), app.state(), false),
            _ => return,
        };
        if let Err(error) = result {
            // Native check items toggle before their handler; restore actual state on failure.
            if let Ok(status) = overlay_status(app.state()) {
                let _ = sync_lyrics_menu(app, &status);
            }
            eprintln!("Could not update floating lyrics: {error}");
        }
    });
    Ok(())
}

#[tauri::command]
fn publish_lyrics(
    window: WebviewWindow,
    state: State<DesktopState>,
    payload: Subtitle,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the player may publish lyrics".into());
    }
    *state.subtitle.lock().map_err(|e| e.to_string())? = payload.clone();
    window
        .emit_to("lyrics", "lyrics-update", payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn current_lyrics(state: State<DesktopState>) -> Result<Subtitle, String> {
    Ok(state.subtitle.lock().map_err(|e| e.to_string())?.clone())
}

fn overlay_status(state: State<DesktopState>) -> Result<OverlayStatus, String> {
    Ok(state.status.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn resize_overlay(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if window.label() != "lyrics" {
        return Err("Only the subtitle window may resize itself".into());
    }
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err("Invalid subtitle dimensions".into());
    }
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let monitor = window.current_monitor().map_err(|e| e.to_string())?;
    let max_width = monitor
        .as_ref()
        .map_or(840.0, |m| m.work_area().size.width as f64 / scale);
    let max_height = monitor
        .as_ref()
        .map_or(600.0, |m| m.work_area().size.height as f64 / scale);
    let size = tauri::LogicalSize::new(width.ceil().min(max_width), height.ceil().min(max_height));
    let physical = size.to_physical::<u32>(scale);
    let previous_size = window.outer_size().map_err(|e| e.to_string())?;
    if previous_size == physical {
        return Ok(());
    }
    let previous_position = window.outer_position().map_err(|e| e.to_string())?;
    // Keep the subtitle's bottom centre anchored across line and font changes.
    let mut x = previous_position.x + (previous_size.width as i32 - physical.width as i32) / 2;
    let mut y = previous_position.y + previous_size.height as i32 - physical.height as i32;
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        x = x.clamp(
            area.position.x,
            area.position.x + (area.size.width as i32 - physical.width as i32).max(0),
        );
        y = y.clamp(
            area.position.y,
            area.position.y + (area.size.height as i32 - physical.height as i32).max(0),
        );
    }
    window.set_size(size).map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_overlay_visible(
    app: tauri::AppHandle,
    state: State<DesktopState>,
    visible: bool,
) -> Result<OverlayStatus, String> {
    let overlay = app
        .get_webview_window("lyrics")
        .ok_or("Missing lyrics window")?;
    let mut status = state.status.lock().map_err(|e| e.to_string())?;
    // Reopening always recovers a locked/off-screen window on the player's display.
    overlay
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;
    status.locked = false;
    if visible {
        if let Some(main) = app.get_webview_window("main") {
            if let Some(monitor) = main.current_monitor().map_err(|e| e.to_string())? {
                let area = monitor.work_area();
                let size = overlay.outer_size().map_err(|e| e.to_string())?;
                overlay
                    .set_position(tauri::PhysicalPosition::new(
                        area.position.x + (area.size.width as i32 - size.width as i32).max(0) / 2,
                        area.position.y
                            + (area.size.height as i32
                                - size.height as i32
                                - (48.0 * monitor.scale_factor()) as i32)
                                .max(0),
                    ))
                    .map_err(|e| e.to_string())?;
            }
        }
        overlay.show().map_err(|e| e.to_string())?;
    } else {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    status.visible = visible;
    let updated = status.clone();
    drop(status);
    sync_lyrics_menu(&app, &updated)?;
    Ok(updated)
}

#[tauri::command]
fn set_overlay_locked(
    app: tauri::AppHandle,
    state: State<DesktopState>,
    locked: bool,
) -> Result<OverlayStatus, String> {
    let overlay = app
        .get_webview_window("lyrics")
        .ok_or("Missing lyrics window")?;
    overlay
        .set_ignore_cursor_events(locked)
        .map_err(|e| e.to_string())?;
    let mut status = state.status.lock().map_err(|e| e.to_string())?;
    status.locked = locked;
    let updated = status.clone();
    drop(status);
    sync_lyrics_menu(&app, &updated)?;
    Ok(updated)
}

fn main() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            setup_lyrics_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            publish_lyrics,
            control_playback,
            current_lyrics,
            resize_overlay,
            set_overlay_visible,
            set_overlay_locked,
            lyric_card::save_lyric_card
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
            if window.label() == "lyrics" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let app = window.app_handle();
                    let _ = set_overlay_visible(app.clone(), app.state(), false);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Failed to run NumazuMusic");
}
