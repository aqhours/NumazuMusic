"use client";

import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowUpRight, ImagePlus, ListRestart, Maximize, Minimize, MoreHorizontal, Moon, Pause, Play, Blend, SkipBack, SkipForward, Languages, Sun, X } from "lucide-react";
import ReaderBackground from "./reader-background";
import { useAmllLowFreqVolume } from "./use-amll-low-freq-volume";
import { loadAudio } from "./audio-cache";
import { useManualLyricScroll } from "./use-manual-lyric-scroll";
import { useLyricEdgeSoftness } from "./use-lyric-edge-softness";
import { useReaderFullscreen } from "./use-reader-fullscreen";
import { useDesktopLyrics, type DesktopPlayback, type PlaybackAction } from "./desktop-lyrics";
import DesktopWindowDrag from "./desktop-window-drag";
import LyricCardEditor from "./lyric-card-editor";
import type { CardLanguage } from "./lyric-card";

import type { Word, LyricLine, Song, Timing, TimedCharacter, DisplayCharacter } from "./song-types";

const alignable = (character: string) => /[\p{L}\p{N}]/u.test(character);
const emptyTimings: TimedCharacter[] = [];
const normalized = (character: string) => character.normalize("NFKC").toLocaleLowerCase();
const formatTime = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function parseYrc(source: string): TimedCharacter[] {
  const characters: TimedCharacter[] = [];
  const tokenPattern = /\((\d+),(\d+),\d+\)([^([]*)/g;

  for (const line of source.split(/\r?\n/)) {
    tokenPattern.lastIndex = 0;
    for (const match of line.matchAll(tokenPattern)) {
      const start = Number(match[1]);
      const duration = Number(match[2]);
      const visible = Array.from(match[3]).filter(alignable);
      visible.forEach((text, index) => {
        const slice = duration / Math.max(visible.length, 1);
        characters.push({ text, start: start + slice * index, end: start + slice * (index + 1) });
      });
    }
  }

  return characters;
}

function collectDisplayCharacters(lyrics: LyricLine[]): DisplayCharacter[] {
  const characters: DisplayCharacter[] = [];
  lyrics.forEach((line, lineIndex) => line.words.forEach((word, wordIndex) => word.jp.forEach((part, partIndex) => {
    Array.from(part.text).forEach((text, characterIndex) => {
      if (alignable(text)) characters.push({ key: `${lineIndex}-${wordIndex}-${partIndex}-${characterIndex}`, text, lineIndex });
    });
  })));
  return characters;
}

function alignTimings(display: DisplayCharacter[], timed: TimedCharacter[], lyrics: LyricLine[]) {
  const width = timed.length + 1;
  const costs = new Uint16Array((display.length + 1) * width);
  const directions = new Uint8Array((display.length + 1) * width);
  for (let row = 1; row <= display.length; row++) { costs[row * width] = row; directions[row * width] = 1; }
  for (let column = 1; column <= timed.length; column++) { costs[column] = column; directions[column] = 2; }

  for (let row = 1; row <= display.length; row++) {
    for (let column = 1; column <= timed.length; column++) {
      const same = normalized(display[row - 1].text) === normalized(timed[column - 1].text);
      const diagonal = costs[(row - 1) * width + column - 1] + (same ? 0 : 2);
      const up = costs[(row - 1) * width + column] + 1;
      const left = costs[row * width + column - 1] + 1;
      const index = row * width + column;
      if (diagonal <= up && diagonal <= left) { costs[index] = diagonal; directions[index] = 0; }
      else if (up <= left) { costs[index] = up; directions[index] = 1; }
      else { costs[index] = left; directions[index] = 2; }
    }
  }

  const timingByKey = new Map<string, Timing>();
  let row = display.length;
  let column = timed.length;
  while (row > 0 || column > 0) {
    const direction = directions[row * width + column];
    if (row > 0 && column > 0 && direction === 0) {
      if (normalized(display[row - 1].text) === normalized(timed[column - 1].text)) {
        timingByKey.set(display[row - 1].key, timed[column - 1]);
      }
      row--; column--;
    } else if (row > 0 && (column === 0 || direction === 1)) row--;
    else column--;
  }

  const lineRanges = lyrics.map((_, lineIndex) => {
    const values = display.filter((character) => character.lineIndex === lineIndex).map((character) => timingByKey.get(character.key)).filter((value): value is Timing => Boolean(value));
    return values.length ? { start: Math.min(...values.map((value) => value.start)), end: Math.max(...values.map((value) => value.end)) } : null;
  });
  // Split an adjacent character's time window into ordered, non-overlapping
  // sweeps. Punctuation uses the same renderer; the overall line timing stays put.
  lyrics.forEach((line, lineIndex) => {
    const characters = line.words.flatMap((word, wordIndex) => word.jp.flatMap((part, partIndex) =>
      Array.from(part.text).map((text, characterIndex) => ({
        text, key: `${lineIndex}-${wordIndex}-${partIndex}-${characterIndex}`,
      })),
    ));
    const anchors = characters.flatMap((character, index) => {
      const timing = timingByKey.get(character.key);
      return timing ? [{ index, timing, members: [index] }] : [];
    });
    for (let index = 0; index < characters.length;) {
      if (!/\p{P}/u.test(characters[index].text)) { index++; continue; }
      const start = index;
      while (index < characters.length && /[\p{P}\s]/u.test(characters[index].text)) index++;
      const previous = anchors.findLast((anchor) => anchor.index < start);
      const following = anchors.find((anchor) => anchor.index >= index);
      const opening = /[\p{Ps}\p{Pi}]/u.test(characters[start].text);
      const anchor = opening ? following ?? previous : previous ?? following;
      if (anchor) {
        for (let member = start; member < index; member++) {
          if (/\p{P}/u.test(characters[member].text)) anchor.members.push(member);
        }
      }
    }
    for (const { timing, members } of anchors) {
      if (members.length === 1) continue;
      members.sort((a, b) => a - b);
      const duration = (timing.end - timing.start) / members.length;
      members.forEach((index, order) => timingByKey.set(characters[index].key, {
        start: timing.start + duration * order,
        end: order === members.length - 1 ? timing.end : timing.start + duration * (order + 1),
      }));
    }
  });
  return { timingByKey, lineRanges };
}

function TimedText({ text, timingPrefix, currentMs, timingByKey }: { text: string; timingPrefix: string; currentMs: number; timingByKey: Map<string, Timing> }) {
  return Array.from(text).map((character, characterIndex) => {
    const timing = timingByKey.get(`${timingPrefix}-${characterIndex}`);
    const progress = timing ? Math.max(0, Math.min(100, ((currentMs - timing.start) / Math.max(timing.end - timing.start, 1)) * 100)) : 0;
    const state = timing && currentMs >= timing.end ? " is-sung" : timing && currentMs >= timing.start ? " is-current" : "";
    return <span className={`timed-character${state}`} data-character={character} style={{ "--character-progress": `${progress}%` } as React.CSSProperties} key={characterIndex}>{character}</span>;
  });
}

function JapaneseWord({ word, lineIndex, wordIndex, currentMs, timingByKey }: { word: Word; lineIndex: number; wordIndex: number; currentMs: number; timingByKey: Map<string, Timing> }) {
  return <span className="word-jp">{word.jp.map((part, partIndex) => {
    const text = <TimedText text={part.text} timingPrefix={`${lineIndex}-${wordIndex}-${partIndex}`} currentMs={currentMs} timingByKey={timingByKey} />;
    return part.reading ? <ruby key={partIndex}>{text}<rt>{part.reading}</rt></ruby> : <span key={partIndex}>{text}</span>;
  })}</span>;
}

const WordBlock = memo(function WordBlock({ word, lineIndex, wordIndex, currentMs, timingByKey }: { word: Word; lineIndex: number; wordIndex: number; currentMs: number; timingByKey: Map<string, Timing> }) {
  const wordStart = useMemo(() => {
    let start = Infinity;
    word.jp.forEach((part, partIndex) => {
      Array.from(part.text).forEach((_, characterIndex) => {
        const timing = timingByKey.get(`${lineIndex}-${wordIndex}-${partIndex}-${characterIndex}`);
        if (timing) start = Math.min(start, timing.start);
      });
    });
    return start;
  }, [word, lineIndex, wordIndex, timingByKey]);
  return (
    <span className={`word-block${currentMs >= wordStart ? " is-started" : ""}`}>
      <JapaneseWord word={word} lineIndex={lineIndex} wordIndex={wordIndex} currentMs={currentMs} timingByKey={timingByKey} />
      <span className="word-romaji" lang="ja-Latn">{word.romaji}</span>
      <span className="word-meaning" lang="zh-CN">{word.meaning}</span>
    </span>
  );
});

type WebPlaybackControls = DesktopPlayback & { canNext: boolean; status: string };

const lyricDisplayModes = {
  annotated: { label: "完整注音", next: "bilingual" },
  bilingual: { label: "中日双语", next: "chinese" },
  chinese: { label: "仅中文", next: "annotated" },
} as const;
type LyricDisplayMode = keyof typeof lyricDisplayModes;

export default function SongReader({ song, coverColors, originalCover, desktopPlayback, webPlayback }: { song: Song; coverColors: string[]; originalCover?: string; desktopPlayback?: DesktopPlayback; webPlayback?: WebPlaybackControls }) {
  const playback = desktopPlayback ?? webPlayback;
  const lyrics = song.lyrics;
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const fullscreen = useReaderFullscreen(fullscreenRef);
  // Generated by npm run palette:generate (node-vibrant); no image analysis during playback.
  const coverPalette = Object.fromEntries(coverColors.map((color, index) => [`--cover-color-${index + 1}`, color])) as React.CSSProperties;
  const audioRef = useRef<HTMLAudioElement>(null);
  const { lowFreqVolumeRef, activateAudioAnalyzer } = useAmllLowFreqVolume(audioRef);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const readerMotionRef = useRef<Animation[]>([]);
  const readerClosingRef = useRef(false);
  useEffect(() => () => { readerMotionRef.current.forEach((animation) => animation.cancel()); }, []);
  const [readerOpen, setReaderOpen] = useState(false);
  useEffect(() => {
    if (!readerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [readerOpen]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!readerOpen || !dialog) return;
    // Match Safari's page-canvas fallback without changing the reader artwork.
    const edgeColor = getComputedStyle(dialog).backgroundColor;
    const surfaces = [document.documentElement, document.body];
    const previous = surfaces.map((element) => ({
      color: element.style.getPropertyValue("background-color"),
      priority: element.style.getPropertyPriority("background-color"),
    }));
    surfaces.forEach((element) => element.style.setProperty("background-color", edgeColor, "important"));
    return () => {
      surfaces.forEach((element, index) => {
      const saved = previous[index];
      if (saved.color) element.style.setProperty("background-color", saved.color, saved.priority);
      else element.style.removeProperty("background-color");
    });
    };
  }, [readerOpen, coverColors]);
  const readerRef = useRef<HTMLOListElement>(null);
  const { manual: manualScroll, resumePlayback } = useManualLyricScroll(readerRef, readerOpen);
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);
  const animationRef = useRef<number | null>(null);
  const lastClockUpdateRef = useRef(0);
  const [timingResource, setTimingResource] = useState<{ source: string; characters: TimedCharacter[] } | null>(null);
  const timedCharacters = timingResource?.source === song.timing ? timingResource.characters : emptyTimings;
  const [audioRequested, setAudioRequested] = useState(false);
  const [audioResource, setAudioResource] = useState<{ source: string; url: string } | null>(null);
  const audioSrc = audioResource?.source === song.audio ? audioResource.url : null;
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [lyricDisplayMode, setLyricDisplayMode] = useState<LyricDisplayMode>("annotated");
  const lyricDisplay = lyricDisplayModes[lyricDisplayMode];
  const lyricDisplayLabel = `歌词显示：${lyricDisplay.label}，点击切换为${lyricDisplayModes[lyricDisplay.next].label}`;
  const [blurLyrics, setBlurLyrics] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Snapshot the song so automatic playback cannot replace an unfinished card.
  const [cardExport, setCardExport] = useState<{ song: Song; coverColors: string[]; initialLanguage: CardLanguage } | null>(null);
  const closeCardExport = useCallback(() => setCardExport(null), []);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!toolsOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !toolsRef.current?.contains(event.target) && !toolsToggleRef.current?.contains(event.target)) setToolsOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setToolsOpen(false);
      toolsToggleRef.current?.focus();
    };
    const desktop = matchMedia("(min-width:1024px)");
    const dismissOnDesktop = () => { if (desktop.matches) setToolsOpen(false); };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape, true);
    desktop.addEventListener("change", dismissOnDesktop);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape, true);
      desktop.removeEventListener("change", dismissOnDesktop);
    };
  }, [toolsOpen]);
  const closeToolsMenu = () => {
    if (!toolsOpen) return;
    setToolsOpen(false);
    toolsToggleRef.current?.focus();
  };
  useLyricEdgeSoftness(readerRef, readerOpen, blurLyrics, song.slug);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [playbackError, setPlaybackError] = useState("");
  const [loadedSong, setLoadedSong] = useState(song.slug);
  if (loadedSong !== song.slug) {
    // Reset track data before committing the next render; keep the audio element mounted.
    setLoadedSong(song.slug);
    setAudioResource(null);
    setTimingResource(null);
    setCurrentMs(0);
    setDurationMs(0);
    setIsPlaying(false);
    setPlaybackError("");
    setAutoScroll(true);
  }
  const displayCharacters = useMemo(() => collectDisplayCharacters(lyrics), [lyrics]);
  const { timingByKey, lineRanges } = useMemo(() => alignTimings(displayCharacters, timedCharacters, lyrics), [displayCharacters, timedCharacters, lyrics]);
  useDesktopLyrics(audioRef, song, lineRanges, { ready: Boolean(audioSrc), canPrevious: Boolean(desktopPlayback?.canPrevious), canNext: Boolean(desktopPlayback && audioRequested), error: playbackError });
  const firstTimedLine = lineRanges.find((range) => range !== null);
  const awaitingFirstLyric = Boolean(firstTimedLine && currentMs < firstTimedLine.start);
  const activeLine = lineRanges.findIndex((range, index) => {
    if (!range || currentMs < range.start) return false;
    const next = lineRanges.slice(index + 1).find(Boolean);
    return !next || currentMs < next.start;
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetch(song.timing, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("Could not load lyric timings");
      return response.text();
    }).then((text) => {
      if (!controller.signal.aborted) setTimingResource({ source: song.timing, characters: parseYrc(text) });
    }).catch(() => {
      if (!controller.signal.aborted) setTimingResource({ source: song.timing, characters: [] });
    });
    return () => controller.abort();
  }, [song.timing]);
  useEffect(() => {
    const syncTheme = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    syncTheme();
  }, []);
  useEffect(() => {
    if (!audioRequested) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;

    loadAudio(song.audio, controller.signal)
      .then(({ blob }) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setAudioResource({ source: song.audio, url: objectUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setAudioResource({ source: song.audio, url: song.audio });
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [song.audio, audioRequested]);
  useEffect(() => {
    // Keep the audio element mounted across track changes, retaining its gesture permission.
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
  }, [audioSrc]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const syncDuration = () => setDurationMs(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    syncDuration();
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("durationchange", syncDuration);
    return () => {
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("durationchange", syncDuration);
    };
  }, []);
  useEffect(() => {
    // Returning to the playing lyric also leaves manual browsing's clear state.
    if (!readerOpen || !autoScroll || activeLine < 0) return;
    const reader = readerRef.current;
    const line = lineRefs.current[activeLine];
    if (!reader || !line) return;
    const first = lineRefs.current[0];
    const last = lineRefs.current[lyrics.length - 1];
    const updateTailSpace = () => {
      const topInset = first?.offsetTop ?? 0;
      // Leave enough trailing space for even the final lyric to reach this anchor.
      const tailSpace = Math.max(80, reader.clientHeight - (last?.offsetHeight ?? 0) - topInset);
      reader.style.paddingBottom = `${tailSpace}px`;
    };
    const followLine = () => {
      updateTailSpace();
      const topInset = first?.offsetTop ?? 0;
      reader.scrollTo({
        top: Math.max(0, line.offsetTop - topInset),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    };
    followLine();
    const restoreBlur = requestAnimationFrame(() => {
      if (audioRef.current && !audioRef.current.paused) resumePlayback();
    });
    // Toolbar height changes only update available space; do not interrupt browsing.
    const resize = new ResizeObserver(updateTailSpace);
    resize.observe(reader);
    resize.observe(line);
    if (last && last !== line) resize.observe(last);
    return () => { cancelAnimationFrame(restoreBlur); resize.disconnect(); };
  }, [activeLine, autoScroll, readerOpen, lyrics.length, lyricDisplayMode, resumePlayback]);
  useEffect(() => () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
  }, []);

  const updateClock = () => {
    if (!audioRef.current) return;
    const audioMs = audioRef.current.currentTime * 1000;
    if (audioRef.current.paused || Math.abs(audioMs - lastClockUpdateRef.current) >= 30) {
      lastClockUpdateRef.current = audioMs;
      setCurrentMs(audioMs);
    }
    if (!audioRef.current.paused) animationRef.current = requestAnimationFrame(updateClock);
  };
  const beginClock = () => { setPlaybackError(""); resumePlayback(); setIsPlaying(true); if (animationRef.current) cancelAnimationFrame(animationRef.current); animationRef.current = requestAnimationFrame(updateClock); };
  const stopClock = () => { setIsPlaying(false); if (animationRef.current) cancelAnimationFrame(animationRef.current); updateClock(); };
  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) await Promise.all([activateAudioAnalyzer(), audio.play()]);
      else audio.pause();
    } catch { setPlaybackError("播放失败，请点击播放重试，或切换下一首"); }
  };
  const seekToTime = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    lastClockUpdateRef.current = seconds * 1000;
    setCurrentMs(seconds * 1000);
  };
  const seekFromPointer = (event: React.PointerEvent<HTMLInputElement>) => {
    if (!durationMs) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    seekToTime(progress * durationMs / 1000);
  };
  const seekToLine = (lineIndex: number) => {
    const audio = audioRef.current;
    const range = lineRanges[lineIndex];
    if (!audio || !range) return;
    audio.currentTime = range.start / 1000;
    // Seeking during playback does not emit another play event.
    if (!audio.paused) resumePlayback();
    lastClockUpdateRef.current = range.start;
    setCurrentMs(range.start);
  };
  const openReader = () => {
    setAudioRequested(true);
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    readerMotionRef.current.forEach((animation) => animation.cancel());
    readerClosingRef.current = false;
    dialog.showModal();
    setReaderOpen(true);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fade = dialog.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: reducedMotion ? 120 : 240, easing: "cubic-bezier(.23,1,.32,1)",
    });
    const content = dialog.querySelector<HTMLElement>(".reader");
    const lift = !reducedMotion && content ? content.animate([
      { transform: "translateY(10px)" }, { transform: "translateY(0)" },
    ], { duration: 280, easing: "cubic-bezier(.23,1,.32,1)" }) : null;
    readerMotionRef.current = lift ? [fade, lift] : [fade];
  };
  const startQueuedTrack = useEffectEvent(() => {
    if (webPlayback && (!readerOpen || readerClosingRef.current)) return;
    openReader();
    setAutoScroll(true);
    const audio = audioRef.current;
    if (!audio) return;
    void Promise.all([activateAudioAnalyzer(), audio.play()]).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPlaybackError("播放失败，请点击播放重试，或切换下一首");
    });
  });
  useEffect(() => {
    const audio = audioRef.current;
    if (!playback?.autoPlay || !audioSrc || !audio) return;
    // The source-loading effect above schedules this media event after effects finish.
    const ready = () => { if (!readerClosingRef.current) startQueuedTrack(); };
    const cancel = () => audio.removeEventListener("canplay", ready);
    const dialog = dialogRef.current;
    audio.addEventListener("canplay", ready, { once: true });
    dialog?.addEventListener("close", cancel);
    return () => { cancel(); dialog?.removeEventListener("close", cancel); };
  }, [playback?.autoPlay, audioSrc]);
  const handleDesktopAction = useEffectEvent((action: PlaybackAction) => {
    if (!desktopPlayback) return;
    if (action === "next") desktopPlayback.onNext();
    else if (action === "previous") desktopPlayback.onPrevious();
    else if (audioSrc) {
      if (audioRef.current?.paused) openReader();
      void togglePlayback();
    }
  });
  const desktopEnabled = Boolean(desktopPlayback);
  useEffect(() => {
    if (!desktopEnabled) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<PlaybackAction>("player-command", ({ payload }) => handleDesktopAction(payload)).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => { if (!disposed) setPlaybackError("悬浮窗播放控制连接失败，请重启应用"); });
    return () => { disposed = true; unlisten?.(); };
  }, [desktopEnabled]);
  const closeReader = () => {
    const dialog = dialogRef.current;
    if (!dialog?.open || readerClosingRef.current) return;
    readerClosingRef.current = true;
    audioRef.current?.pause();
    // Capture the current frame before cancelling an interrupted entrance.
    const opacity = getComputedStyle(dialog).opacity;
    const content = dialog.querySelector<HTMLElement>(".reader");
    const transform = content ? getComputedStyle(content).transform : "none";
    readerMotionRef.current.forEach((animation) => animation.cancel());
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fade = dialog.animate([{ opacity }, { opacity: 0 }], {
      duration: reducedMotion ? 100 : 160, easing: "cubic-bezier(.23,1,.32,1)", fill: "forwards",
    });
    const settle = !reducedMotion && content ? content.animate([
      { transform }, { transform: "translateY(6px)" },
    ], { duration: 160, easing: "cubic-bezier(.23,1,.32,1)", fill: "forwards" }) : null;
    readerMotionRef.current = settle ? [fade, settle] : [fade];
    void fade.finished.then(() => {
      dialog.close();
      readerMotionRef.current.forEach((animation) => animation.cancel());
      readerMotionRef.current = [];
      readerClosingRef.current = false;
    }).catch(() => { /* Cancellation is expected when the reader unmounts. */ });
  };
  const onReaderClosed = () => {
    fullscreen.exit();
    audioRef.current?.pause();
    setReaderOpen(false);
    setToolsOpen(false);
    setCardExport(null);
    startRef.current?.focus({ preventScroll: true });
  };
  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("numazumusic-theme", nextTheme); } catch { /* Theme still works without storage. */ }
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    setTheme(nextTheme);
  };

  return (
    <main className={`song-page song-${song.slug}`} style={{ "--song-backdrop": `url(${song.backdrop})` } as React.CSSProperties}>
      <header className="hero">
        <div className="hero-shade" aria-hidden="true" />
        {/* vinext currently duplicates React when hydrating next/link in this client reader. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="library-link" href="/" aria-label="返回歌词本"><ArrowLeft aria-hidden="true" /> <span>歌词本</span></a>
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "切换到浅色模式" : "切换到暗色模式"} title={theme === "dark" ? "浅色模式" : "暗色模式"} aria-pressed={theme === "dark"} data-umami-event="theme-change" data-umami-event-theme={theme === "dark" ? "light" : "dark"}>
          <Moon className="theme-icon theme-icon-moon" aria-hidden="true" />
          <Sun className="theme-icon theme-icon-sun" aria-hidden="true" />
        </button>
        <div className="hero-inner">
          <h1>{song.title}<br /><em>{song.titleAccent}</em></h1>
          <p className="title-cn">{song.titleCn}</p>
          <dl className="credits" aria-label="歌曲制作信息">
            <div><dt>作詞</dt><dd>{song.credits.lyricist}</dd></div>
            <div><dt>作曲</dt><dd>{song.credits.composer}</dd></div>
            <div><dt>編曲</dt><dd>{song.credits.arranger}</dd></div>
            <div><dt>演唱</dt><dd>{song.artist}</dd></div>
          </dl>
          <button ref={startRef} className="start-link" type="button" onClick={openReader} aria-haspopup="dialog" aria-controls="lyrics-dialog" data-umami-event="reader-start" data-umami-event-song={song.slug}>开始阅读 <ArrowUpRight aria-hidden="true" /></button>
        </div>
      </header>
      <dialog ref={dialogRef} id="lyrics-dialog" className="reader-dialog" style={coverPalette} aria-label={`${song.title}${song.titleAccent} · 歌词阅读`} onClose={onReaderClosed} onCancel={(event) => { event.preventDefault(); if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); } else { closeReader(); } }}>
      <div ref={fullscreenRef} className="reader-surface">
      {desktopPlayback && <DesktopWindowDrag />}
      {readerOpen && <ReaderBackground album={song.cover} playing={isPlaying} lowFreqVolumeRef={lowFreqVolumeRef} />}
      <section className="reader" data-lyric-font="sans" data-annotations={lyricDisplayMode === "annotated"} data-lyric-display={lyricDisplayMode} data-lyric-blur={blurLyrics} id="lyrics" aria-label="歌词正文">
        <div className={`player-bar${webPlayback ? " web-player-bar" : ""}`}>
          {/* The synchronized, translated lyric transcript is rendered directly below the audio control. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio ref={audioRef} className="audio-player" preload={playback?.autoPlay ? "auto" : "metadata"} loop={!playback} src={audioSrc ?? undefined} data-source={song.audio} onPlay={beginClock} onPause={stopClock} onEnded={() => { stopClock(); playback?.onNext(); }} onSeeked={updateClock} onEmptied={() => { lastClockUpdateRef.current = 0; setCurrentMs(0); setDurationMs(0); setIsPlaying(false); setPlaybackError(""); }} onError={() => { if (audioSrc) setPlaybackError("音频加载失败，请重试或切换下一首"); }}>你的浏览器不支持音频播放。</audio>
          <picture className="mini-cover" data-playing={isPlaying}>
            <source media="(min-width:1024px)" srcSet={originalCover ?? song.cover} />
            <img src={song.cover} width="256" height="256" decoding="async" loading="lazy" alt="" />
          </picture>
          <div className="transport-controls" role="group" aria-label="播放控制">
            {webPlayback && <button className="track-toggle" type="button" disabled={!webPlayback.canPrevious} onClick={webPlayback.onPrevious} aria-label="上一首" title="上一首" data-umami-event="audio-previous" data-umami-event-song={song.slug}><SkipBack aria-hidden="true" /></button>}
          <button className="play-toggle" type="button" disabled={!audioSrc} onClick={togglePlayback} aria-label={isPlaying ? "暂停" : "播放"} data-umami-event={isPlaying ? "audio-pause" : "audio-play"} data-umami-event-song={song.slug}>
            {isPlaying ? <Pause aria-hidden="true" /> : <Play className="play-icon" aria-hidden="true" />}
          </button>
            {webPlayback && <button className="track-toggle" type="button" disabled={!webPlayback.canNext} onClick={webPlayback.onNext} aria-label="下一首" title="下一首" data-umami-event="audio-next" data-umami-event-song={song.slug}><SkipForward aria-hidden="true" /></button>}
          </div>
          <div className="timeline">
            <span className="song-meta"><strong>{song.slug === "mirai-ticket" ? "MIRAI TICKET" : `${song.title}${song.titleAccent}`}</strong><span>{song.artist}</span>{!audioSrc && <span className="song-loading-status" role="status">歌曲加载中...</span>}</span>
            <input className="progress-slider" type="range" min="0" max={durationMs ? durationMs / 1000 : 0} step="0.01" value={currentMs / 1000} disabled={!durationMs} onInput={(event) => seekToTime(Number(event.currentTarget.value))} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seekFromPointer(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} aria-label="播放进度" style={{ "--progress": `${durationMs ? Math.min(100, currentMs / durationMs * 100) : 0}%` } as React.CSSProperties} />
            <span className="time-display"><span>{formatTime(currentMs)}</span><span>{formatTime(durationMs)}</span></span>
          </div>
          {webPlayback && <button ref={toolsToggleRef} className="reader-tools-toggle" type="button" aria-label="更多歌词功能" aria-expanded={toolsOpen} aria-controls="reader-tools" onClick={() => setToolsOpen((value) => !value)}><MoreHorizontal aria-hidden="true" /></button>}
          <div ref={toolsRef} id="reader-tools" className="reader-tools" data-open={toolsOpen} role="group" aria-label="歌词功能">
          <button className={`scroll-toggle${autoScroll ? " is-on" : ""}`} type="button" aria-label={autoScroll ? "关闭自动跟随" : "开启自动跟随"} title={autoScroll ? "自动跟随已开启" : "自动跟随已关闭"} aria-pressed={autoScroll} onClick={() => { closeToolsMenu(); setAutoScroll((value) => !value); }} data-umami-event={autoScroll ? "auto-follow-disable" : "auto-follow-enable"} data-umami-event-song={song.slug}><ListRestart aria-hidden="true" /><span className="reader-tool-label">自动跟随<span className="reader-tool-state">{autoScroll ? "开启" : "关闭"}</span></span></button>
          <button className={`annotations-toggle${lyricDisplayMode !== "bilingual" ? " is-on" : ""}`} type="button" aria-label={lyricDisplayLabel} title={lyricDisplayLabel} onClick={() => { closeToolsMenu(); setLyricDisplayMode((value) => lyricDisplayModes[value].next); }}>
            {lyricDisplayMode === "chinese" ? <span className="lyric-display-character" aria-hidden="true">中</span> : <Languages aria-hidden="true" />}<span className="reader-tool-label">歌词显示<span className="reader-tool-state">{lyricDisplay.label}</span></span>
          </button>
          {webPlayback && <button className={`blur-toggle${blurLyrics ? " is-on" : ""}`} type="button" aria-label={blurLyrics ? "关闭歌词模糊" : "开启歌词模糊"} title={blurLyrics ? "歌词模糊已开启" : "歌词模糊已关闭"} aria-pressed={blurLyrics} onClick={() => { closeToolsMenu(); setBlurLyrics((value) => !value); }}><Blend aria-hidden="true" /><span className="reader-tool-label">歌词模糊<span className="reader-tool-state">{blurLyrics ? "开启" : "关闭"}</span></span></button>}
          <button className="card-export-toggle" type="button" aria-label="导出歌词卡片" title="导出歌词卡片" aria-haspopup="dialog" onClick={() => { closeToolsMenu(); setCardExport({ song, coverColors, initialLanguage: lyricDisplayMode === "chinese" ? "zh" : "ja" }); }}><ImagePlus aria-hidden="true" /><span className="reader-tool-label">导出歌词卡片</span></button>
          <button className="fullscreen-toggle" type="button" onClick={() => { closeToolsMenu(); fullscreen.toggle(); }} disabled={!fullscreen.supported || fullscreen.pending} aria-label={fullscreen.isFullscreen ? "退出全屏" : "进入全屏"} aria-pressed={fullscreen.isFullscreen} title={!fullscreen.supported ? "当前浏览器不支持网页全屏" : fullscreen.isFullscreen ? "退出全屏（Esc）" : "进入全屏"}>
            {fullscreen.isFullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}<span className="reader-tool-label">{fullscreen.isFullscreen ? "退出全屏" : "进入全屏"}</span>
          </button>
          <button className="reader-close" type="button" onClick={() => { closeToolsMenu(); closeReader(); }} aria-label="关闭歌词界面" title="关闭歌词界面（Esc）"><X aria-hidden="true" /><span className="reader-tool-label">关闭歌词界面</span></button>
          </div>
          {fullscreen.error && <span className="fullscreen-status" role="status">{fullscreen.error}</span>}
          {webPlayback?.status && <span className="fullscreen-status" role="status">{webPlayback.status}</span>}
          {playbackError && <span className="fullscreen-status" role="status">{playbackError}</span>}
        </div>
        <div className="lyrics-viewport">
        <ol className="lyrics-list" ref={readerRef} data-manual-scroll={manualScroll}>
          {awaitingFirstLyric && (
            <li className="lyric-intro" data-playing={readerOpen && isPlaying}>
              <span className="sr-only">前奏，歌词即将开始</span>
              <span className="lyric-intro-dots" aria-hidden="true">
                {[0, 1, 2].map((index) => {
                  const introDuration = firstTimedLine?.start ?? 0;
                  const progress = introDuration > 0 ? Math.max(0, Math.min(1, currentMs / introDuration * 3 - index)) : 0;
                  return <i key={index} style={{ opacity: .3 + .7 * progress }} />;
                })}
              </span>
            </li>
          )}
          {lyrics.map((line, lineIndex) => (
            <li className={`lyric-line${line.aside ? " is-aside" : ""}${lineIndex === activeLine ? " is-active" : ""}`} key={lineIndex} ref={(element) => { lineRefs.current[lineIndex] = element; }}>
              <button className="line-content line-seek" type="button" disabled={!lineRanges[lineIndex]} onClick={() => seekToLine(lineIndex)} aria-label={`跳转到第 ${lineIndex + 1} 句：${line.zh}`}>
                <span className="word-strip" lang="ja">{line.words.map((word, wordIndex) => {
                  const range = lineRanges[lineIndex];
                  const lineClock = !range ? 0 : currentMs < range.start ? range.start - 1 : currentMs > range.end ? range.end + 1 : currentMs;
                  return <WordBlock word={word} lineIndex={lineIndex} wordIndex={wordIndex} currentMs={lineClock} timingByKey={timingByKey} key={wordIndex} />;
                })}</span>
                <span className="translation" lang="zh-CN">{line.zh}</span>
              </button>
            </li>
          ))}
        </ol>
        </div>
      </section>
      {readerOpen && cardExport && <LyricCardEditor {...cardExport} onClose={closeCardExport} />}
      </div>
      </dialog>
    </main>
  );
}
