"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Download, ImagePlus, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { cardLanguageLabels, cardPng, createCardThemes, japaneseLyric, loadCardImage, MAX_CARD_LINES, renderLyricCard, type CardLanguage, type CardTheme } from "./lyric-card";
import coverThumbnails from "./cover-thumbnails.json";
import type { Song } from "./song-types";
import "./lyric-card.css";

type CardPreview = { key: string; url: string; blob: Blob; width: number; height: number };

// The reader supplies 256 px covers; cards use the larger local asset for export.
const cardCovers = new Map(Object.entries(coverThumbnails).flatMap(([original, sizes]): [string, string][] => [
  [original, sizes["640"]], [sizes["256"], sizes["640"]],
]));

const LyricCardEditor = memo(function LyricCardEditor({ song, coverColors, initialLanguage, onClose }: {
  song: Song; coverColors: string[]; initialLanguage: CardLanguage; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [language, setLanguage] = useState<CardLanguage>(initialLanguage);
  const [theme, setTheme] = useState<CardTheme>("soft");
  const cardThemes = useMemo(() => createCardThemes(coverColors), [coverColors]);
  const [selected, setSelected] = useState<number[]>([]);
  const [step, setStep] = useState<"select" | "preview">("select");
  const [cover, setCover] = useState<{ image: HTMLImageElement | null } | null>(null);
  const [preview, setPreview] = useState<CardPreview | null>(null);
  const [renderError, setRenderError] = useState<{ key: string; message: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(false);
  const previewKey = `${language}:${theme}:${cardThemes[theme].background}:${selected.join(",")}:${cover ? "ready" : "loading"}`;
  const currentPreview = preview?.key === previewKey ? preview : null;
  const error = renderError?.key === previewKey ? renderError.message : "";
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const limitReached = selected.length >= MAX_CARD_LINES;
  const coverSource = cardCovers.get(song.cover) ?? song.cover;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    mountedRef.current = true;
    dialog?.showModal();
    return () => {
      mountedRef.current = false;
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCardImage(coverSource, controller.signal).then((image) => {
      if (!controller.signal.aborted) setCover({ image });
    });
    return () => controller.abort();
  }, [coverSource]);

  useEffect(() => {
    if (!cover || !selected.length) return;
    let cancelled = false;
    let url: string | undefined;
    // Coalesce quick selections; preview and download always use the same PNG.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const canvas = renderLyricCard({ song, indices: selected, language, theme, colors: coverColors, cover: cover.image });
          const { width, height } = canvas;
          let blob: Blob;
          try { blob = await cardPng(canvas); }
          finally { canvas.width = 1; canvas.height = 1; }
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          setRenderError(null);
          setPreview({ key: previewKey, url, blob, width, height });
        } catch (cause) {
          if (!cancelled) setRenderError({ key: previewKey, message: cause instanceof Error ? cause.message : "图片生成失败，请重试。" });
        }
      })();
    }, 100);
    return () => { cancelled = true; clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [song, selected, language, theme, coverColors, cover, previewKey]);

  const toggleLine = (index: number) => {
    setSaveStatus("");
    setSelected((current) => current.includes(index) ? current.filter((value) => value !== index)
      : current.length < MAX_CARD_LINES ? [...current, index].sort((a, b) => a - b) : current);
  };

  const saveImage = async () => {
    if (!currentPreview || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveStatus("");
    try {
      const filename = `yomikana-${song.slug}-${language}.png`;
      if (isTauri()) {
        const path = await invoke<string>("save_lyric_card", { filename, png: Array.from(new Uint8Array(await currentPreview.blob.arrayBuffer())) });
        if (mountedRef.current) setSaveStatus(`已保存到下载文件夹：${path.split(/[\\/]/).pop()}`);
      } else {
        // Give the download its own URL so editing or closing cannot revoke it early.
        const url = URL.createObjectURL(currentPreview.blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        dialogRef.current?.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setSaveStatus("已开始下载，也可以长按预览图片保存。");
      }
    } catch (cause) {
      if (mountedRef.current) setSaveStatus(`保存失败：${cause instanceof Error ? cause.message : String(cause)}。请重试。`);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="lyric-card-dialog" aria-labelledby="lyric-card-title" aria-describedby="lyric-card-description"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); dialogRef.current?.close(); }}
      onClose={(event) => { event.stopPropagation(); if (!event.currentTarget.open) onClose(); }}>
      <div className="lyric-card-editor" data-step={step}>
        <header className="card-editor-header">
          <div><span className="card-editor-eyebrow">YOMIKANA / 歌词收藏</span><h2 id="lyric-card-title">把喜欢的歌词，留成卡片。</h2><p id="lyric-card-description">选几句触动你的歌词，保存这一刻的共鸣。</p></div>
          <button className="card-icon-button" type="button" onClick={() => dialogRef.current?.close()} aria-label="关闭歌词卡片"><X aria-hidden="true" /></button>
        </header>
        <div className="card-mobile-steps" role="group" aria-label="制作步骤">
          <button type="button" aria-pressed={step === "select"} onClick={() => setStep("select")}>1 <span>选择歌词</span></button>
          <ChevronRight aria-hidden="true" />
          <button type="button" aria-pressed={step === "preview"} disabled={!selected.length} onClick={() => setStep("preview")}>2 <span>预览卡片</span></button>
        </div>
        <div className="card-editor-body">
          <section className="card-selection-panel" aria-label="选择歌词">
            <div className="card-panel-heading"><span>选择歌词</span><span className="card-count" aria-live="polite">{selected.length} / {MAX_CARD_LINES} 句</span></div>
            <div className="card-segments" role="group" aria-label="卡片歌词语言">
              {(Object.keys(cardLanguageLabels) as CardLanguage[]).map((value) => <button type="button" key={value} aria-pressed={language === value} onClick={() => { setLanguage(value); setSaveStatus(""); }}>{cardLanguageLabels[value]}</button>)}
            </div>
            <div className="card-selection-caption"><p>{limitReached ? "已选满，取消一句后可继续选择" : "可选择不连续的句子，按原歌词顺序排列"}</p><button type="button" disabled={!selected.length} onClick={() => { setSelected([]); setSaveStatus(""); }}>清空</button></div>
            <ol className="card-lyric-options" aria-label={`${song.title}${song.titleAccent} · ${cardLanguageLabels[language]}歌词`}>
              {song.lyrics.map((line, index) => {
                const checked = selectedSet.has(index);
                const japanese = japaneseLyric(line);
                return <li key={index}>
                  <label className="card-lyric-option" data-selected={checked} data-unavailable={!checked && limitReached}>
                    <input type="checkbox" checked={checked} disabled={!checked && limitReached} onChange={() => toggleLine(index)} />
                    <span className="sr-only">第 {index + 1} 句：</span>
                    <span className="card-line-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <span className="card-line-text"><span lang={language === "zh" ? "zh-CN" : "ja"}>{language === "zh" ? line.zh : japanese}</span>{language === "both" && <span className="card-line-translation" lang="zh-CN">{line.zh}</span>}</span>
                    <span className="card-line-check" aria-hidden="true">{checked && <Check />}</span>
                  </label>
                </li>;
              })}
            </ol>
          </section>
          <section className="card-preview-panel" aria-label="卡片预览">
            <div className="card-panel-heading"><span>卡片预览</span><span className="card-preview-format">PNG · 高清图片</span></div>
            <div className="card-theme-options" role="group" aria-label="卡片样式">
              {(Object.keys(cardThemes) as CardTheme[]).map((value) => <button type="button" key={value} aria-pressed={theme === value} onClick={() => { setTheme(value); setSaveStatus(""); }}><i className="card-theme-swatch" style={{ background: cardThemes[value].background }} aria-hidden="true" />{cardThemes[value].label}</button>)}
            </div>
            <div className="card-preview-stage" aria-busy={Boolean(selected.length && !currentPreview && !error)}>
              {!selected.length ? <div className="card-preview-empty"><ImagePlus aria-hidden="true" /><strong>留住一段旋律</strong><p>从歌词里选几句，<br />你的卡片就会出现在这里。</p></div>
                : error ? <p className="card-preview-error" role="alert">{error}</p>
                : currentPreview ? <picture><img className="card-preview-image" src={currentPreview.url} width={currentPreview.width} height={currentPreview.height} alt={`${song.title}${song.titleAccent} · ${cardLanguageLabels[language]}歌词卡片，已选择 ${selected.length} 句`} /></picture>
                : <p className="card-preview-loading" role="status">正在生成卡片…</p>}
            </div>
            <p className="card-preview-note">{currentPreview ? `${currentPreview.width} × ${currentPreview.height} px` : ""}{cover && !cover.image ? `${currentPreview ? " · " : ""}封面暂不可用，已使用唱片图案` : ""}</p>
          </section>
        </div>
        <footer className="card-editor-footer">
          <div className="card-export-status" role="status">{saveStatus || (selected.length ? `已选 ${selected.length} 句${cardLanguageLabels[language]}歌词` : "先选择想要收藏的歌词")}</div>
          <button className="card-primary-button card-next-button" type="button" disabled={!selected.length} onClick={() => setStep("preview")}>预览卡片<ChevronRight aria-hidden="true" /></button>
          <button className="card-primary-button card-save-button" type="button" disabled={!currentPreview || saving} onClick={() => void saveImage()}><Download aria-hidden="true" />{saving ? "正在保存…" : "保存图片"}</button>
        </footer>
      </div>
    </dialog>
  );
});

export default LyricCardEditor;
