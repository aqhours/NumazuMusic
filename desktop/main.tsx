import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import SongReader from "../app/song-reader";
import DesktopWindowDrag from "../app/desktop-window-drag";
import { songs } from "../app/song-data";
import palettes from "../app/cover-palettes.json";
import thumbnails from "../app/cover-thumbnails.json";
import Overlay from "./overlay";
import { nextTrack, previousTrack, startQueue, type ShuffleQueue } from "./shuffle-queue";
import "../app/globals.css";
import "./desktop.css";

const tracks = Object.keys(songs);
function manualSelection(route: string) {
  const slug = route.replace(/^\/songs\//, "");
  return { route, queue: songs[slug] ? startQueue(tracks, slug) : null as ShuffleQueue | null, autoPlay: false };
}

function App() {
  const [session, setSession] = useState(() => manualSelection(location.hash.slice(1) || "/"));
  useEffect(() => { history.replaceState(null, "", `#${session.route}`); }, [session.route]);
  useEffect(() => {
    const navigate = () => { setSession(manualSelection(location.hash.slice(1) || "/")); window.scrollTo(0, 0); };
    const followLink = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const url = new URL(anchor.href);
      if (url.origin === location.origin && (url.pathname === "/" || url.pathname.startsWith("/songs/"))) {
        event.preventDefault();
        location.hash = url.pathname;
      }
    };
    window.addEventListener("hashchange", navigate);
    document.addEventListener("click", followLink);
    return () => { window.removeEventListener("hashchange", navigate); document.removeEventListener("click", followLink); };
  }, []);
  const changeTrack = (direction: "previous" | "next") => {
    setSession((current) => {
      if (!current.queue || (direction === "previous" && current.queue.cursor === 0)) return current;
      const queue = direction === "next" ? nextTrack(current.queue, tracks) : previousTrack(current.queue);
      return { route: `/songs/${queue.history[queue.cursor]}`, queue, autoPlay: true };
    });
  };
  const song = songs[session.route.replace(/^\/songs\//, "")];
  if (!song) return <><DesktopWindowDrag /><Home /></>;
  const cover = (thumbnails as Record<string, Record<string, string>>)[song.cover]?.[256] ?? song.cover;
  return <><DesktopWindowDrag /><SongReader song={{ ...song, cover }} originalCover={song.cover} coverColors={(palettes as Record<string, string[]>)[song.cover] ?? []} desktopPlayback={{ autoPlay: session.autoPlay, canPrevious: Boolean(session.queue && session.queue.cursor > 0), onNext: () => changeTrack("next"), onPrevious: () => changeTrack("previous") }} /></>;
}

createRoot(document.getElementById("root")!).render(location.hash === "#/overlay" ? <Overlay /> : <App />);
