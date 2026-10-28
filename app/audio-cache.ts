const AUDIO_CACHE_NAME = "numazumusic-audio-v1";

export type AudioLoadSource = "cache" | "network-cached" | "network";

type AudioLoadResult = {
  blob: Blob;
  source: AudioLoadSource;
};

/**
 * Loads a complete audio file, preferring the browser's persistent Cache
 * Storage. Network and storage failures are intentionally independent: a
 * full cache must never prevent a song from playing.
 */
export async function loadAudio(songUrl: string, signal: AbortSignal): Promise<AudioLoadResult> {
  const request = new Request(new URL(songUrl, window.location.href));
  let cache: Cache | null = null;

  if ("caches" in window) {
    try {
      cache = await window.caches.open(AUDIO_CACHE_NAME);
      const cachedResponse = await cache.match(request);

      if (cachedResponse?.ok) {
        return { blob: await cachedResponse.blob(), source: "cache" };
      }
    } catch {
      // Private browsing modes and storage policies can disable Cache Storage.
    }
  }

  const response = await fetch(request, { signal });
  if (!response.ok) throw new Error(`Audio request failed with ${response.status}`);

  const cacheResponse = response.clone();
  const blobPromise = response.blob();
  let stored = false;

  if (cache && response.status === 200) {
    try {
      await cache.put(request, cacheResponse);
      stored = true;

      // Best effort only. The cache still works when persistent storage is not
      // available, but the browser may evict it under storage pressure.
      void navigator.storage?.persist?.().catch(() => false);
    } catch {
      // Quota exhaustion must fall back to the already-downloaded response.
    }
  }

  return { blob: await blobPromise, source: stored ? "network-cached" : "network" };
}
