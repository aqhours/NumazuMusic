"use client";

import type { ReactNode } from "react";
import { domAnimation, LazyMotion, MotionConfig, type Transition } from "motion/react";
import * as m from "motion/react-m";

const revealVariants = {
  hidden: { opacity: 0, transform: "translateY(20px)" },
  visible: { opacity: 1, transform: "translateY(0px)" },
};
const viewport = { once: true, amount: 0.12, margin: "0px 0px -24px 0px" } as const;
const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];

function revealTransition(delay: number): Transition {
  return {
    type: "tween", duration: 0.85, ease, delay,
    opacity: { type: "tween", duration: 0.7, ease, delay },
  };
}

export default function HomeScrollReveal({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <main className="library-page">
          {/* Keep every link available when JavaScript is disabled. */}
          <noscript><style>{".home-scroll-reveal { opacity:1 !important; transform:none !important; }"}</style></noscript>
          {children}
        </main>
      </MotionConfig>
    </LazyMotion>
  );
}

export function HomeYearMarker({ children }: { children: ReactNode }) {
  return (
    <m.div
      className="release-year-marker home-scroll-reveal"
      initial="hidden" whileInView="visible" viewport={viewport}
      variants={revealVariants} transition={revealTransition(0)}
    >
      {children}
    </m.div>
  );
}

export function HomeSongCard({ children, slug, delay }: { children: ReactNode; slug: string; delay: number }) {
  return (
    <m.a
      className="release-card home-scroll-reveal" href={`/songs/${slug}`}
      initial="hidden" whileInView="visible" viewport={viewport}
      variants={revealVariants} transition={revealTransition(delay)}
      data-umami-event="song-open" data-umami-event-song={slug}
    >
      {children}
    </m.a>
  );
}
