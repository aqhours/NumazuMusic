import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { SkipBack, SkipForward, Pause, Play } from "lucide-react";
import type { Subtitle } from "../app/desktop-lyrics";

function savedNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? fallback : Number(raw);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  } catch { return fallback; }
}

export default function Overlay() {
  const shellRef = useRef<HTMLElement>(null);
  const [maxWidth, setMaxWidth] = useState(840);
  const [subtitle, setSubtitle] = useState<Subtitle>({ title: "", japanese: "", translation: "", playing: false, ready: false, canPrevious: false, canNext: false, error: "" });
  const [controlsSuppressed, setControlsSuppressed] = useState(false);
  const [fontSize, setFontSize] = useState(() => savedNumber("subtitle-size", 28, 20, 40));
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const updateLimit = async () => {
      const monitor = await currentMonitor();
      if (!disposed && monitor) setMaxWidth(Math.max(240, Math.min(840, Math.floor(monitor.workArea.size.width / monitor.scaleFactor) - 32)));
    };
    void updateLimit().catch(console.error);
    void getCurrentWindow().onMoved(() => { void updateLimit().catch(console.error); }).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(console.error);
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    let disposed = false;
    let pending = false;
    let previous = "";
    // Serialize resize requests so fast font/lyric changes cannot apply out of order.
    const resize = async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        while (!disposed) {
          const bounds = shell.getBoundingClientRect();
          const width = Math.ceil(bounds.width);
          const height = Math.ceil(bounds.height);
          const size = `${width}:${height}`;
          if (!width || !height || size === previous) break;
          await invoke("resize_overlay", { width, height });
          previous = size;
        }
      } catch {
        if (!disposed) setError("字幕窗口尺寸调整失败，请重试");
      } finally { pending = false; }
    };
    const observer = new ResizeObserver(() => { void resize(); });
    observer.observe(shell);
    void resize();
    return () => { disposed = true; observer.disconnect(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let received = false;
    void listen<Subtitle>("lyrics-update", ({ payload }) => {
      received = true;
      if (!disposed) setSubtitle(payload);
    }).then(async (stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      const latest = await invoke<Subtitle>("current_lyrics");
      if (!disposed && !received) setSubtitle(latest);
    }).catch(() => { if (!disposed) setError("歌词同步失败，请重启应用"); });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem("subtitle-size", String(fontSize)); } catch { /* Preferences are optional. */ }
  }, [fontSize]);
  const perform = (action: Promise<unknown>) => {
    setError("");
    void action.catch(() => setError("操作失败，请重试"));
  };
  const translatedText = subtitle.japanese ? subtitle.translation : subtitle.title || "开启歌曲后，歌词会同步显示在这里";
  return <main ref={shellRef} className="subtitle-shell" style={{ "--subtitle-size": `${fontSize}px`, "--subtitle-max-width": `${maxWidth}px` } as React.CSSProperties}>
    <div className="subtitle-window" data-controls-suppressed={controlsSuppressed} onPointerMove={() => setControlsSuppressed(false)} onFocus={() => setControlsSuppressed(false)}>
    <div className="subtitle-toolbar">
      <button type="button" data-tauri-drag-region title="拖动字幕位置" aria-label="拖动字幕位置">⠿</button>
      <button type="button" title="上一首" aria-label="上一首" disabled={!subtitle.canPrevious} onClick={() => perform(invoke("control_playback", { action: "previous" }))}><SkipBack aria-hidden="true" /></button>
      <button type="button" title={subtitle.playing ? "暂停播放" : "播放"} aria-label={subtitle.playing ? "暂停播放" : "播放"} disabled={!subtitle.ready} onClick={() => perform(invoke("control_playback", { action: "toggle" }))}>{subtitle.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
      <button type="button" title="下一首" aria-label="下一首" disabled={!subtitle.canNext} onClick={() => perform(invoke("control_playback", { action: "next" }))}><SkipForward aria-hidden="true" /></button>
      <button type="button" aria-label="缩小字号" disabled={fontSize <= 20} onClick={() => setFontSize((size) => Math.max(20, size - 2))}>A−</button>
      <button type="button" aria-label="放大字号" disabled={fontSize >= 40} onClick={() => setFontSize((size) => Math.min(40, size + 2))}>A+</button>
      <button type="button" title="鼠标穿透；在 Mac 菜单栏「显示 → 解锁悬浮歌词」恢复" onClick={() => perform(invoke("set_overlay_locked", { locked: true }).then(() => setControlsSuppressed(true)))}>锁定</button>
      <button type="button" aria-label="关闭悬浮歌词" onClick={() => perform(invoke("set_overlay_visible", { visible: false }))}>×</button>
    </div>
    <div className="subtitle-copy">
      <p className="subtitle-japanese" lang="ja">{subtitle.japanese || (subtitle.title ? "♪" : "请在 NumazuMusic 中播放歌曲")}</p>
      {translatedText && <p className="subtitle-translation" lang="zh-CN">{translatedText}</p>}
    </div>
    {(error || subtitle.error) && <p className="subtitle-error" role="status">{error || subtitle.error}</p>}
    </div>
  </main>;
}
