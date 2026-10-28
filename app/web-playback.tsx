"use client";

import { useEffect, useRef, useState } from "react";
import SongReader from "./song-reader";
import type { Song } from "./song-types";

export type WebTrack = { song: Song; coverColors: string[]; originalCover: string };

export default function WebPlayback({ initialTrack, queue }: { initialTrack: WebTrack; queue: string[] }) {
  const [track, setTrack] = useState(initialTrack);
  const [autoPlay, setAutoPlay] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const changeTrack = async (direction: number) => {
    if (requestRef.current || queue.length < 2) return;
    const index = queue.indexOf(track.song.slug);
    if (index < 0) return;
    const slug = queue[(index + direction + queue.length) % queue.length];
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/songs/${slug}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Track unavailable");
      const nextTrack: WebTrack = await response.json();
      if (controller.signal.aborted) return;
      setAutoPlay(true);
      setTrack(nextTrack);
      window.history.replaceState(window.history.state, "", `/songs/${slug}`);
      document.title = `${nextTrack.song.title}${nextTrack.song.titleAccent} · NumazuMusic`;
    } catch {
      if (!controller.signal.aborted) setError("切歌失败，请重试");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  };

  return <SongReader {...track} webPlayback={{ autoPlay, canPrevious: queue.length > 1 && !loading, canNext: queue.length > 1 && !loading, onPrevious: () => void changeTrack(-1), onNext: () => void changeTrack(1), status: loading ? "正在切换歌曲…" : error }} />;
}
