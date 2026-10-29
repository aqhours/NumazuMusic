import { catalog } from "./song-catalog";
import ThemeToggle from "./theme-toggle";
import coverThumbnails from "./cover-thumbnails.json";

const thumbnails = coverThumbnails as Record<string, Record<string, string>>;



const releaseTimeline = [...new Set(catalog.map((song) => song.releaseDate.slice(0, 4)))].map((year) => ({
  year,
  songs: catalog.filter((song) => song.releaseDate.startsWith(year)),
}));

export default function Home() {
  return (
    <main className="library-page">
      <ThemeToggle />

      <section className="library-hero" aria-labelledby="library-title">
        <div className="library-hero-inner">
          <header className="library-heading">
            <h1 id="library-title">Numazu<br />Music</h1>
            <p><strong>你的心灵是否光芒闪耀？</strong></p>
          </header>
        </div>
      </section>

      <section className="release-timeline" id="songs" aria-labelledby="catalog-title">
        <div className="release-timeline-inner">
          <h2 className="sr-only" id="catalog-title">歌曲列表</h2>

          <ol className="release-timeline-list">
            {releaseTimeline.map(({ year, songs }) => (
              <li className="release-year" key={year}>
                <div className="release-year-marker">
                  <time dateTime={year}>{year}</time>
                  <span aria-hidden="true" />
                </div>
                <div className="release-year-songs">
                  {songs.map((song) => (
                    <a className="release-card" href={`/songs/${song.slug}`} key={song.slug} data-umami-event="song-open" data-umami-event-song={song.slug}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbnails[song.cover]?.[640] ?? song.cover} width="640" height="640" loading={song === catalog[0] ? "eager" : "lazy"} decoding="async" alt="" />
                      <div className="release-card-copy">
                        <h3>{song.title}</h3>
                        <p>{song.artist}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
