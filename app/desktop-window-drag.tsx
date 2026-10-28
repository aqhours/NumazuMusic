/** Invisible native drag target, rendered only by the Mac app. */
export default function DesktopWindowDrag() {
  return <div className="desktop-window-drag" data-tauri-drag-region aria-hidden="true" />;
}
