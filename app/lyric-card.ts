import type { LyricLine, Song } from "./song-types";

export type CardLanguage = "ja" | "zh" | "both";
export type CardTheme = "soft" | "rich";
export const MAX_CARD_LINES = 12;
export const cardLanguageLabels: Record<CardLanguage, string> = { ja: "日语", zh: "中文", both: "双语" };

function coverHue(hex: string): [number, number] {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (!delta) return [0, 0];
  const lightness = (max + min) / 2;
  const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, delta / (1 - Math.abs(2 * lightness - 1))];
}

function hslHex(hue: number, saturation: number, lightness: number): string {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return `#${[0, 8, 4].map((offset) => {
    const phase = (offset + hue / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(phase - 3, 9 - phase, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  }).join("")}`;
}

export function createCardThemes(colors: readonly string[]) {
  // The saved palette starts with the cover's Vibrant swatch. Preserve its hue,
  // temper saturation and lift lightness; even the richer option stays light.
  const seed = colors.find((color) => /^#[\da-f]{6}$/i.test(color)) ?? "#808080";
  const [hue, saturation] = coverHue(seed);
  const text = {
    ink: hslHex(hue, saturation * .2, .13),
    muted: hslHex(hue, saturation * .15, .32),
    cover: hslHex(hue, saturation * .28, .76),
  };
  return {
    soft: { label: "柔和", background: hslHex(hue, saturation * .36, .92), ...text },
    rich: { label: "鲜明", background: hslHex(hue, saturation * .55, .82), ...text },
  };
}

export function japaneseLyric(line: LyricLine): string {
  return line.words.map((word) => word.jp.map((part) => part.text).join("")).join("");
}

export function selectedCardLines(lyrics: LyricLine[], indices: readonly number[]) {
  return [...new Set(indices)].filter((index) => Number.isInteger(index) && index >= 0 && index < lyrics.length)
    .sort((a, b) => a - b).map((index) => ({ index, japanese: japaneseLyric(lyrics[index]), chinese: lyrics[index].zh }));
}

// Break at grapheme boundaries, keeping closing punctuation with its preceding text.
// A wrapped line is only a visual continuation: the original lyric groups stay intact.
export function wrapCardText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const split = (value: string) => [...segmenter.segment(value)].map((part) => part.segment);
  const graphemes = split(text);
  const lines: string[] = [];
  let line = "";
  for (const character of graphemes) {
    if (character === "\n") { lines.push(line); line = ""; continue; }
    if (line && measure(line + character) > maxWidth) {
      if (/^[、。，．！？!?：:；;）」』】〕〉》”’]/u.test(character)) {
        const previous = split(line);
        const last = previous.pop()!;
        if (previous.length && measure(last + character) <= maxWidth) {
          lines.push(previous.join(""));
          line = last + character;
          continue;
        }
      }
      // Do not strand an opening bracket on the preceding line.
      if (/[（(「『【〔〈《“‘]$/u.test(line) && line.length > 1) {
        const last = line.slice(-1);
        lines.push(line.slice(0, -1));
        line = last + character;
        continue;
      }
      lines.push(line);
      line = "";
    }
    line += character;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

const sans = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif';
const japaneseSans = '"Hiragino Sans", "Yu Gothic", -apple-system, BlinkMacSystemFont, sans-serif';
const brandFont = '"Arial Black", "Avenir Next", Arial, sans-serif';
const cardWidth = 600;
const preferredScale = 4;
const maxCardHeight = 4000;
// Match the native PNG limits and bound canvas memory for long selections.
const maxExportHeight = 8000;
const maxExportPixels = 16_000_000;

export function loadCardImage(src: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    const image = new Image();
    image.crossOrigin = "anonymous";
    const finish = (value: HTMLImageElement | null) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
      if (!value) image.src = "";
      resolve(value);
    };
    const abort = () => finish(null);
    const timer = setTimeout(() => finish(null), 6000);
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    signal.addEventListener("abort", abort, { once: true });
    image.src = src;
  });
}

export function renderLyricCard({ song, indices, language, theme, colors, cover }: {
  song: Song; indices: readonly number[]; language: CardLanguage; theme: CardTheme;
  colors: string[]; cover: HTMLImageElement | null;
}): HTMLCanvasElement {
  const selected = selectedCardLines(song.lyrics, indices);
  if (!selected.length) throw new Error("请先选择想保存的歌词。");
  if (selected.length > MAX_CARD_LINES) throw new Error(`一张卡片最多选择 ${MAX_CARD_LINES} 句歌词。`);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前设备无法生成图片，请换一个浏览器重试。");
  const palette = createCardThemes(colors)[theme];
  const { ink, muted } = palette;
  const inset = 60;
  const coverSize = 72;
  const metadataX = inset + coverSize + 24;
  const metadataWidth = cardWidth - inset - metadataX;
  const titleSize = 24;
  const titleLineHeight = 34;
  const artistSize = 22;
  const artistLineHeight = 32;
  const fontSize = selected.length <= 3 ? 34 : selected.length <= 6 ? 30 : 26;
  const lineHeight = fontSize * 1.6;
  const lyricFont = language === "zh" ? sans : japaneseSans;
  const primaryFont = `700 ${fontSize}px ${lyricFont}`;
  const secondaryFont = `600 20px ${sans}`;
  const titleFont = `700 ${titleSize}px ${japaneseSans}`;
  const artistFont = `600 ${artistSize}px ${sans}`;
  const textWidth = cardWidth - inset * 2;
  const measure = (text: string) => ctx.measureText(text).width;
  const title = `${song.title}${song.titleAccent}`;
  ctx.font = titleFont;
  const titleLines = wrapCardText(title, metadataWidth, measure);
  ctx.font = artistFont;
  const artistLines = wrapCardText(song.artist, metadataWidth, measure);
  const brandHeight = 14;
  const wordmark = "NumaZu Music";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 40px ${brandFont}`;
  const sample = ctx.measureText(wordmark);
  const brandFontSize = 40 * brandHeight / Math.max(1, sample.actualBoundingBoxAscent + sample.actualBoundingBoxDescent);
  const signatureFont = `900 ${brandFontSize}px ${brandFont}`;
  // Use visible glyph bounds for both vertical edges and left alignment.
  // Font line boxes have different built-in leading and side bearings.
  const measureTextBlock = (lines: string[], font: string, lineStep: number) => {
    ctx.font = font;
    const rows = lines.map((text) => ({ text, metrics: ctx.measureText(text) }));
    const top = Math.min(...rows.map((row, index) => index * lineStep - row.metrics.actualBoundingBoxAscent));
    const bottom = Math.max(...rows.map((row, index) => index * lineStep + row.metrics.actualBoundingBoxDescent));
    return { rows, font, lineStep, baselineOffset: -top, height: bottom - top };
  };
  const titleBlock = measureTextBlock(titleLines, titleFont, titleLineHeight);
  const artistBlock = measureTextBlock(artistLines, artistFont, artistLineHeight);
  const signatureBlock = measureTextBlock([wordmark], signatureFont, 0);
  const metadataRowGap = 12;
  const metadataHeight = titleBlock.height + metadataRowGap + artistBlock.height;
  // Keep the text stack slightly shorter than the cover, including long names.
  const metadataScale = Math.min(1, (coverSize - 12) / metadataHeight);
  const groups = selected.map((line) => {
    ctx.font = primaryFont;
    const primary = wrapCardText(language === "zh" ? line.chinese : line.japanese, textWidth, measure);
    ctx.font = secondaryFont;
    const secondary = language === "both" ? wrapCardText(line.chinese, textWidth, measure) : [];
    return { primary, secondary, height: primary.length * lineHeight + (secondary.length ? 10 + secondary.length * 32 : 0) };
  });
  const groupGap = language === "both" ? 32 : 24;
  const lyricsHeight = groups.reduce((sum, group) => sum + group.height, 0) + (groups.length - 1) * groupGap;
  const topSpace = 64;
  const headerGap = 64;
  const footerGap = 80;
  const iconSize = 20;
  const iconGap = 9;
  const footerHeight = Math.max(iconSize, signatureBlock.height);
  const bottomSpace = 64;
  const contentHeight = topSpace + coverSize + headerGap + lyricsHeight + footerGap + footerHeight + bottomSpace;
  const height = Math.ceil(Math.max(640, contentHeight));
  if (height > maxCardHeight) throw new Error("这些歌词太长了，请减少几句后再导出。");
  const scale = Math.min(preferredScale, maxExportHeight / height, Math.sqrt(maxExportPixels / (cardWidth * height)));
  canvas.width = Math.floor(cardWidth * scale);
  canvas.height = Math.floor(height * scale);
  ctx.scale(canvas.width / cardWidth, canvas.height / height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, cardWidth, height);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  let y = topSpace + coverSize + headerGap + (height - contentHeight) / 2;
  groups.forEach((group) => {
    ctx.fillStyle = ink;
    ctx.font = primaryFont;
    group.primary.forEach((line) => { ctx.fillText(line, inset, y); y += lineHeight; });
    if (group.secondary.length) {
      y += 10;
      ctx.fillStyle = muted;
      ctx.font = secondaryFont;
      group.secondary.forEach((line) => { ctx.fillText(line, inset, y); y += 32; });
    }
    y += groupGap;
  });

  const metadataY = topSpace;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(inset, metadataY, coverSize, coverSize, 6);
  ctx.clip();
  if (cover) {
    const side = Math.min(cover.naturalWidth, cover.naturalHeight);
    ctx.drawImage(cover, (cover.naturalWidth - side) / 2, (cover.naturalHeight - side) / 2, side, side, inset, metadataY, coverSize, coverSize);
  } else {
    ctx.fillStyle = palette.cover;
    ctx.fillRect(inset, metadataY, coverSize, coverSize);
    ctx.strokeStyle = palette.muted;
    for (const radius of [24, 15, 3]) { ctx.beginPath(); ctx.arc(inset + coverSize / 2, metadataY + coverSize / 2, radius, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.restore();
  ctx.save();
  ctx.translate(metadataX, metadataY + (coverSize - metadataHeight * metadataScale) / 2);
  ctx.scale(metadataScale, metadataScale);
  ctx.textBaseline = "alphabetic";
  const drawTextBlock = (block: ReturnType<typeof measureTextBlock>, top: number, color: string) => {
    ctx.font = block.font;
    ctx.fillStyle = color;
    block.rows.forEach(({ text, metrics }, index) => {
      ctx.fillText(text, metrics.actualBoundingBoxLeft, top + block.baselineOffset + index * block.lineStep);
    });
  };
  drawTextBlock(titleBlock, 0, ink);
  const artistY = titleBlock.height + metadataRowGap;
  drawTextBlock(artistBlock, artistY, muted);
  ctx.restore();

  const footerY = height - bottomSpace - footerHeight;
  // A solid headset with a thick band and filled ear cups stays clear at this size.
  ctx.save();
  ctx.translate(inset, footerY + (footerHeight - iconSize) / 2);
  ctx.fillStyle = muted;
  ctx.beginPath();
  ctx.moveTo(0, 13);
  ctx.lineTo(0, 10);
  ctx.arc(10, 10, 10, Math.PI, 0);
  ctx.lineTo(20, 13);
  ctx.lineTo(16.5, 13);
  ctx.lineTo(16.5, 10);
  ctx.arc(10, 10, 6.5, 0, Math.PI, true);
  ctx.lineTo(3.5, 13);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(0, 9, 7, 11, 2.5);
  ctx.roundRect(13, 9, 7, 11, 2.5);
  ctx.fill();
  ctx.restore();

  const brandMetrics = signatureBlock.rows[0].metrics;
  const brandWidth = brandMetrics.actualBoundingBoxLeft + brandMetrics.actualBoundingBoxRight;
  ctx.save();
  ctx.translate(inset + iconSize + iconGap, footerY + (footerHeight - signatureBlock.height) / 2);
  ctx.scale(Math.min(1.18, (textWidth - iconSize - iconGap) / Math.max(1, brandWidth)), 1);
  ctx.textBaseline = "alphabetic";
  drawTextBlock(signatureBlock, 0, muted);
  ctx.restore();
  return canvas;
}

export function cardPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("图片生成失败，请减少歌词数量后重试。"));
  }, "image/png"));
}
