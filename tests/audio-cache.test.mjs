import assert from "node:assert/strict";
import test from "node:test";

import { loadAudio } from "../app/audio-cache.ts";

function installBrowserMocks({ failWrites = false } = {}) {
  const entries = new Map();
  let networkRequests = 0;
  const cache = {
    async match(request) {
      return entries.get(request.url)?.clone();
    },
    async put(request, response) {
      if (failWrites) throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      entries.set(request.url, response.clone());
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { href: "https://numazumusic.test/songs/example" }, caches: { async open() { return cache; } } },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { async persist() { return true; } } },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => {
      networkRequests += 1;
      return new Response("audio bytes", { headers: { "content-type": "audio/mpeg" } });
    },
  });

  return { networkRequests: () => networkRequests };
}

test("stores a downloaded song and reuses it without another network request", async () => {
  const mock = installBrowserMocks();
  const signal = new AbortController().signal;

  const first = await loadAudio("/audio/example.mp3", signal);
  const second = await loadAudio("/audio/example.mp3", signal);

  assert.equal(first.source, "network-cached");
  assert.equal(second.source, "cache");
  assert.equal(await second.blob.text(), "audio bytes");
  assert.equal(mock.networkRequests(), 1);
});

test("keeps downloaded audio playable when the cache is full", async () => {
  const mock = installBrowserMocks({ failWrites: true });
  const result = await loadAudio("/audio/example.mp3", new AbortController().signal);

  assert.equal(result.source, "network");
  assert.equal(await result.blob.text(), "audio bytes");
  assert.equal(mock.networkRequests(), 1);
});
