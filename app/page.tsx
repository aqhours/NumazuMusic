import { catalog } from "./song-catalog";
import ThemeToggle from "./theme-toggle";
import coverThumbnails from "./cover-thumbnails.json";
import HomeScrollReveal, { HomeSongCard, HomeYearMarker } from "./home-scroll-reveal";

const thumbnails = coverThumbnails as Record<string, Record<string, string>>;



const releaseTimeline = [...new Set(catalog.map((song) => song.releaseDate.slice(0, 4)))].map((year) => ({
  year,
  songs: catalog.filter((song) => song.releaseDate.startsWith(year)),
}));

export default function Home() {
  return (
    <HomeScrollReveal>
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
                <HomeYearMarker>
                  <time dateTime={year}>{year}</time>
                  <span aria-hidden="true" />
                </HomeYearMarker>
                <div className="release-year-songs">
                  {songs.map((song, index) => (
                    <HomeSongCard key={song.slug} slug={song.slug} delay={Math.min(index, 3) * 0.06}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbnails[song.cover]?.[640] ?? song.cover} width="640" height="640" loading={song === catalog[0] ? "eager" : "lazy"} decoding="async" alt="" />
                      <div className="release-card-copy">
                        <h3>{song.title}</h3>
                        <p>{song.artist}</p>
                      </div>
                    </HomeSongCard>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </HomeScrollReveal>
  );
}
