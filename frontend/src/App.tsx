import React, { useEffect, useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import init, { process_gif_to_ascii_color, process_image_to_ascii_with_preset } from 'wasm-core';
import type { AsciiRenderPreset, AsciiRenderPresetId, PackedAsciiAnimation } from './types/ascii';

// --- Composants ---
import { AsciiViewer } from './components/AsciiViewer';
import { Preloader } from './components/Preloader';
import { customEase } from './lib/motion';

// --- UI & Icônes ---
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Upload, Download, Settings2, Sparkles, Feather, Code2, Newspaper, WandSparkles, ArrowUpNarrowWide } from 'lucide-react';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 16_000_000;
const ALLOWED_MIME_TYPES = new Set(['image/gif', 'image/png', 'image/jpeg', 'image/webp']);
const FRAME_DELAY_MS = 100;
const FONT_SIZE = 10;
const CHAR_WIDTH = 6;
const CHAR_HEIGHT = 10;
const CHAR_CACHE = Array.from({ length: 256 }, (_, index) => String.fromCharCode(index));
const PRELOADER_MIN_MS = 2200;

const RENDER_PRESETS: AsciiRenderPreset[] = [
  { id: 'classic', label: 'Classic', description: 'Rendu équilibré et lisible.', wasmPreset: 'classic', accent: 'text-orange-500' },
  { id: 'manga', label: 'Manga', description: 'Contraste plus net et texture dense.', wasmPreset: 'manga', accent: 'text-fuchsia-400' },
  { id: 'neon', label: 'Neon', description: 'Boost de couleur et contours vifs.', wasmPreset: 'neon', accent: 'text-cyan-400' },
  { id: 'terminal', label: 'Terminal', description: 'Vibe console sobre.', wasmPreset: 'terminal', accent: 'text-emerald-400' },
  { id: 'newspaper', label: 'Newspaper', description: 'Look imprimé et contrasté.', wasmPreset: 'newspaper', accent: 'text-stone-300' },
  { id: 'matrix', label: 'Matrix', description: 'Look sombre avec grain numérique.', wasmPreset: 'matrix', accent: 'text-lime-400' }
];

type ExportWorkerRequest =
  | { type: 'start'; width: number; height: number }
  | { type: 'frame'; rgba: ArrayBuffer; delayCs: number }
  | { type: 'finish' };

type ExportWorkerResponse =
  | { type: 'done'; gif: ArrayBuffer }
  | { type: 'error'; message: string };

function asPositiveInt(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Champ ${field} invalide`);
  }
  return parsed;
}

function asUint8Array(value: unknown, field: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error(`Champ ${field} invalide`);
}

function asUint16Array(value: unknown, field: string): Uint16Array {
  if (value instanceof Uint16Array) return value;
  if (Array.isArray(value)) return Uint16Array.from(value as number[]);
  throw new Error(`Champ ${field} invalide`);
}

function normalizePackedAnimation(raw: unknown): PackedAsciiAnimation {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Réponse GIF invalide');
  }

  const payload = raw as Record<string, unknown>;
  const width = asPositiveInt(payload.width, 'width');
  const height = asPositiveInt(payload.height, 'height');
  const frameCount = asPositiveInt(payload.frameCount, 'frameCount');
  const chars = asUint8Array(payload.chars, 'chars');
  const rgb = asUint8Array(payload.rgb, 'rgb');
  let delaysMs = asUint16Array(payload.delaysMs, 'delaysMs');

  const cellsPerFrame = width * height;
  if (chars.length !== cellsPerFrame * frameCount) {
    throw new Error('Taille chars incohérente');
  }
  if (rgb.length !== cellsPerFrame * frameCount * 3) {
    throw new Error('Taille rgb incohérente');
  }
  if (delaysMs.length !== frameCount) {
    const fallback = new Uint16Array(frameCount);
    fallback.fill(FRAME_DELAY_MS);
    delaysMs = fallback;
  }

  return { width, height, frameCount, chars, rgb, delaysMs };
}

function drawPackedAsciiFrame(
  ctx: CanvasRenderingContext2D,
  animation: PackedAsciiAnimation,
  frameIndex: number,
  canvasWidth: number,
  canvasHeight: number,
  isDarkMode: boolean
) {
  ctx.fillStyle = isDarkMode ? '#000000' : '#f4f4f5';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.font = `bold ${FONT_SIZE}px monospace`;
  ctx.textBaseline = 'top';

  const frameCells = animation.width * animation.height;
  const charOffset = frameIndex * frameCells;
  const rgbOffset = charOffset * 3;

  for (let i = 0; i < frameCells; i++) {
    const charCode = animation.chars[charOffset + i];
    if (charCode === 0 || charCode === 32) continue;

    const rgbIndex = rgbOffset + i * 3;
    const red = animation.rgb[rgbIndex];
    const green = animation.rgb[rgbIndex + 1];
    const blue = animation.rgb[rgbIndex + 2];
    const x = (i % animation.width) * CHAR_WIDTH;
    const y = Math.floor(i / animation.width) * CHAR_HEIGHT;

    ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    ctx.fillText(CHAR_CACHE[charCode], x, y);
  }
}

const App: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();
  const uploadInputId = useId();
  const widthInputId = useId();
  const presetInputId = useId();
  const statusRegionId = useId();
  const [gifAnimation, setGifAnimation] = useState<PackedAsciiAnimation | null>(null);
  const [staticAscii, setStaticAscii] = useState('');
  const [width, setWidth] = useState(100);
  const [renderPresetId, setRenderPresetId] = useState<AsciiRenderPresetId>('classic');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [gifFrameIndex, setGifFrameIndex] = useState(0);
  const [gifIsPlaying, setGifIsPlaying] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isWasmReady, setIsWasmReady] = useState(false);
  
  // State pour le preloader
  const [appLoaded, setAppLoaded] = useState(false);
  const selectedPreset = RENDER_PRESETS.find((preset) => preset.id === renderPresetId) ?? RENDER_PRESETS[0];

  useEffect(() => {
    let mounted = true;
    let timerId = 0;

    const bootstrap = async () => {
      const minDelay = new Promise<void>((resolve) => {
        timerId = window.setTimeout(resolve, shouldReduceMotion ? 0 : PRELOADER_MIN_MS);
      });

      try {
        await init();
        if (mounted) setIsWasmReady(true);
      } catch (err) {
        console.error('Erreur init WASM:', err);
        if (mounted) {
          setErrorMessage('Initialisation WASM impossible. Recharge la page puis réessaie.');
        }
      } finally {
        await minDelay;
        if (mounted) setAppLoaded(true);
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
      clearTimeout(timerId);
    };
  }, [shouldReduceMotion]);

  useEffect(() => {
    if (!isWasmReady || !sourceFile) return;

    let cancelled = false;
    const renderSource = async () => {
      setErrorMessage(null);
      setIsLoading(true);

      try {
        const bitmap = await createImageBitmap(sourceFile);
        const sourcePixels = bitmap.width * bitmap.height;
        bitmap.close();

        if (sourcePixels > MAX_SOURCE_PIXELS) {
          throw new Error('Image trop grande. Réduis ses dimensions avant l’import.');
        }

        const bytes = new Uint8Array(await sourceFile.arrayBuffer());
        if (sourceFile.type === 'image/gif') {
          const rawResult = await process_gif_to_ascii_color(bytes, width, selectedPreset.wasmPreset);
          if (cancelled) return;
          const animation = normalizePackedAnimation(rawResult);
          setGifAnimation(animation);
          setStaticAscii('');
          setGifFrameIndex(0);
          setGifIsPlaying(true);
        } else {
          const result = await process_image_to_ascii_with_preset(bytes, width, selectedPreset.wasmPreset);
          if (cancelled) return;
          setStaticAscii(result);
          setGifAnimation(null);
          setGifFrameIndex(0);
          setGifIsPlaying(true);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Erreur WASM:', err);
          setErrorMessage(err instanceof Error ? err.message : 'Erreur de traitement du fichier');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void renderSource();

    return () => {
      cancelled = true;
    };
  }, [isWasmReady, selectedPreset.wasmPreset, sourceFile, width]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    setErrorMessage(null);
    if (!isWasmReady) {
      setErrorMessage('Le moteur WASM n’est pas encore prêt. Patiente un instant puis réessaie.');
      return;
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setErrorMessage('Type de fichier non supporté. Utilise un GIF, PNG, JPEG ou WebP.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage('Fichier trop volumineux. Limite: 20 MB.');
      return;
    }

    setGifAnimation(null);
    setStaticAscii('');
    setSourceFile(file);
  };

  const handleExport = async () => {
    if (isExporting) return;
    if (!gifAnimation) {
      setErrorMessage('L’export GIF est disponible uniquement après l’import d’un GIF animé.');
      return;
    }

    setErrorMessage(null);
    setIsExporting(true);

    let worker: Worker | null = null;
    try {
      const canvasWidth = gifAnimation.width * CHAR_WIDTH;
      const canvasHeight = gifAnimation.height * CHAR_HEIGHT;
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Erreur de contexte 2D');

      worker = new Worker(new URL('./workers/export.worker.ts', import.meta.url), { type: 'module' });
      const workerDone = new Promise<ArrayBuffer>((resolve, reject) => {
        worker!.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
          const data = event.data;
          if (data.type === 'done') {
            resolve(data.gif);
            return;
          }
          if (data.type === 'error') {
            reject(new Error(data.message));
          }
        };
        worker!.onerror = (event) => reject(new Error(event.message || 'Erreur Worker export'));
      });

      const startMessage: ExportWorkerRequest = {
        type: 'start',
        width: canvasWidth,
        height: canvasHeight
      };
      worker.postMessage(startMessage);

      for (let frameIndex = 0; frameIndex < gifAnimation.frameCount; frameIndex++) {
        drawPackedAsciiFrame(ctx, gifAnimation, frameIndex, canvasWidth, canvasHeight, true);

        const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
        const rgba = new Uint8Array(imageData.data);
        const delayMs = gifAnimation.delaysMs[frameIndex] || FRAME_DELAY_MS;
        const delayCs = Math.max(1, Math.round(delayMs / 10));
        const frameMessage: ExportWorkerRequest = { type: 'frame', rgba: rgba.buffer, delayCs };
        worker.postMessage(frameMessage, [rgba.buffer]);
      }

      const finishMessage: ExportWorkerRequest = { type: 'finish' };
      worker.postMessage(finishMessage);
      const gifBuffer = await workerDone;

      const blob = new Blob([gifBuffer], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'fig2tig_masterpiece.gif';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erreur Export:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Erreur lors de l\'export GIF');
    } finally {
      if (worker) worker.terminate();
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-black text-zinc-100 font-sans selection:bg-orange-500 selection:text-white bg-grain">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to Main Content
      </a>

      {/* 1. THE AWWARDS PRELOADER */}
      <Preloader isLoaded={appLoaded} />

      {/* 2. THE MAIN LAYOUT */}
      <main
        id="main-content"
        className="relative z-10 flex min-h-screen w-full flex-col gap-8 p-4 md:p-8 lg:h-screen lg:flex-row"
      >
        
        {/* COLONNE GAUCHE: Contrôles & Typo */}
        <motion.div 
          initial={shouldReduceMotion ? false : { opacity: 0, x: -50 }}
          animate={appLoaded ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: shouldReduceMotion ? 0.2 : 1.2, ease: customEase, delay: shouldReduceMotion ? 0 : 0.4 }}
          className="flex flex-1 flex-col justify-between"
        >
          <header className="pt-4">
            <h1 className="text-6xl font-black leading-[0.85] tracking-tighter text-white md:text-[5.5rem]">
              ASCII <br/> 
              <span className="text-orange-500 italic font-serif font-light tracking-normal">Masterpiece.</span>
            </h1>
            <p className="mt-8 max-w-sm text-xs uppercase leading-relaxed text-zinc-500 font-mono">
              High-performance WebAssembly engine. <br/> converting pixels into typography at 60fps.
            </p>
          </header>

          <div className="space-y-6 mt-12 lg:mt-0 pb-4">
            {/* Panneau de configuration */}
            <div className="group relative rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-6 backdrop-blur-md transition-colors hover:border-zinc-700 hover:bg-zinc-900/50">
              <div className="flex items-center gap-3 mb-8">
                <Settings2 aria-hidden="true" className="h-4 w-4 text-orange-500" />
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Engine Parameters</h3>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-[10px] uppercase font-mono text-zinc-500">
                  <label htmlFor={presetInputId}>Render Pack</label>
                  <span className={`font-semibold ${selectedPreset.accent}`}>{selectedPreset.label}</span>
                </div>

                <div id={presetInputId} className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {RENDER_PRESETS.map((preset) => {
                    const isActive = preset.id === renderPresetId;

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setRenderPresetId(preset.id)}
                        className={`rounded-xl border px-3 py-3 text-left transition-colors ${isActive ? 'border-orange-500 bg-orange-500/10' : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-900/80'}`}
                      >
                        <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${preset.accent}`}>
                          {preset.id === 'classic' && <ArrowUpNarrowWide className="h-3 w-3" />}
                          {preset.id === 'manga' && <Feather className="h-3 w-3" />}
                          {preset.id === 'neon' && <Sparkles className="h-3 w-3" />}
                          {preset.id === 'terminal' && <Code2 className="h-3 w-3" />}
                          {preset.id === 'newspaper' && <Newspaper className="h-3 w-3" />}
                          {preset.id === 'matrix' && <WandSparkles className="h-3 w-3" />}
                          <span>{preset.label}</span>
                        </div>
                        <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">{preset.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between items-end text-[10px] uppercase font-mono text-zinc-500">
                  <label htmlFor={widthInputId}>Resolution Matrix</label>
                  <span className="text-lg font-sans leading-none tracking-tighter tabular-nums text-white">
                    {width}
                    <span className="ml-1 text-[10px] text-zinc-600">px</span>
                  </span>
                </div>
                <input
                  id={widthInputId}
                  name="output-width"
                  type="range"
                  min="40"
                  max="150"
                  value={width}
                  onChange={(e) => setWidth(parseInt(e.target.value, 10))}
                  className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-500"
                />
              </div>
            </div>

            {/* Boutons d'Action Magnétiques */}
            <div className="grid grid-cols-2 gap-4">
              <label
                htmlFor={uploadInputId}
                className="group relative flex h-28 touch-manipulation flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-zinc-800 bg-black/50 transition-colors hover:border-orange-500/50 focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500/40"
              >
                <input
                  id={uploadInputId}
                  name="media-upload"
                  type="file"
                  accept="image/gif,image/png,image/jpeg,image/webp"
                  onChange={handleFile}
                  aria-describedby={statusRegionId}
                  className="sr-only"
                />
                <motion.div
                  whileHover={!shouldReduceMotion ? { y: -2 } : undefined}
                  className="flex flex-col items-center gap-3"
                >
                  <Upload aria-hidden="true" className="h-5 w-5 text-zinc-500 transition-colors group-hover:text-orange-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 group-hover:text-orange-400 transition-colors">Upload Media</span>
                </motion.div>
                <div className="absolute inset-0 bg-orange-500/5 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out" />
              </label>

              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting || !gifAnimation || !isWasmReady}
                className="group relative flex h-28 touch-manipulation flex-col items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 transition-colors hover:border-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <motion.div
                  whileHover={!shouldReduceMotion && !isExporting && !!gifAnimation ? { y: -2 } : undefined}
                  className="relative z-10 flex flex-col items-center gap-3"
                >
                  {isExporting ? (
                    <Sparkles aria-hidden="true" className="h-5 w-5 motion-safe:animate-pulse text-black" />
                  ) : (
                    <Download aria-hidden="true" className="h-5 w-5 text-orange-500 transition-colors group-hover:text-black" />
                  )}
                  <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${isExporting ? 'text-black' : 'text-zinc-300 group-hover:text-black'}`}>
                    {isExporting ? 'Encoding…' : 'Export GIF'}
                  </span>
                </motion.div>
                <div className="absolute inset-0 bg-orange-500 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out z-0" />
              </button>
            </div>

            <p id={statusRegionId} className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">
              Upload GIF, PNG, JPEG or WebP. GIF export is available for animated GIF inputs only.
            </p>
            
            {errorMessage && (
              <motion.div
                initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                aria-live="polite"
                aria-atomic="true"
                role="status"
                className="mt-4 rounded-xl border border-red-900/30 bg-red-950/20 p-3 text-[10px] uppercase tracking-wider text-red-400 font-mono"
              >
                <span className="mr-2 font-bold">Erreur:</span> {errorMessage}
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* COLONNE DROITE: Le Canvas (Viewer) */}
        <motion.div 
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={appLoaded ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: shouldReduceMotion ? 0.2 : 1.2, ease: customEase, delay: shouldReduceMotion ? 0 : 0.6 }}
          className="relative h-[50vh] min-h-[24rem] flex-[1.8] overflow-hidden rounded-4xl border border-zinc-800/50 bg-black shadow-2xl lg:h-full"
        >
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div 
                key="loading"
                initial={shouldReduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                aria-live="polite"
                aria-atomic="true"
                role="status"
                className="absolute inset-0 z-20 flex items-center justify-center bg-black"
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="h-8 w-8 rounded-full border-2 border-orange-500 border-t-transparent motion-safe:animate-spin" />
                  <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Processing Pixels…</p>
                </div>
              </motion.div>
            ) : gifAnimation || staticAscii ? (
              <motion.div
                key="viewer"
                initial={shouldReduceMotion ? false : { clipPath: "polygon(0 100%, 100% 100%, 100% 100%, 0% 100%)" }}
                animate={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0% 100%)" }}
                transition={{ duration: shouldReduceMotion ? 0.2 : 1.2, ease: customEase }}
                className="absolute inset-0 flex items-center justify-center bg-zinc-950 p-4"
              >
                <div className="flex h-full w-full flex-col gap-4">
                  <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                    {staticAscii && (
                      <div className="max-h-full max-w-full overflow-auto">
                        <pre className="font-mono text-[5px] leading-tight text-zinc-300">{staticAscii}</pre>
                      </div>
                    )}
                    {gifAnimation && (
                      <AsciiViewer
                        animation={gifAnimation}
                        isDarkMode={true}
                        frameDelayMs={FRAME_DELAY_MS}
                        selectedFrameIndex={gifFrameIndex}
                        isPlaying={gifIsPlaying}
                        onFrameChange={setGifFrameIndex}
                      />
                    )}
                  </div>

                  {gifAnimation && gifAnimation.frameCount > 1 && (
                    <div className="shrink-0 rounded-2xl border border-zinc-800/70 bg-black/60 p-3 backdrop-blur-sm">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setGifIsPlaying((current) => !current)}
                          className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-200 transition-colors hover:border-orange-500 hover:text-orange-400"
                        >
                          {gifIsPlaying ? 'Pause timeline' : 'Play timeline'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setGifIsPlaying(false);
                            setGifFrameIndex((current) => Math.max(0, current - 1));
                          }}
                          className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-colors hover:border-orange-500 hover:text-orange-400"
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setGifIsPlaying(false);
                            setGifFrameIndex((current) => Math.min(gifAnimation.frameCount - 1, current + 1));
                          }}
                          className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-colors hover:border-orange-500 hover:text-orange-400"
                        >
                          Next
                        </button>
                        <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                          Frame {gifFrameIndex + 1} / {gifAnimation.frameCount}
                        </span>
                      </div>

                      <input
                        type="range"
                        min="0"
                        max={Math.max(0, gifAnimation.frameCount - 1)}
                        value={gifFrameIndex}
                        onChange={(event) => {
                          setGifIsPlaying(false);
                          setGifFrameIndex(parseInt(event.target.value, 10));
                        }}
                        className="mt-3 h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-orange-500"
                      />

                      <div className="mt-3 grid max-h-24 grid-flow-col auto-cols-[minmax(2rem,1fr)] gap-2 overflow-x-auto pb-1">
                        {gifAnimation.delaysMs.map((delay, index) => {
                          const isActive = index === gifFrameIndex;
                          return (
                            <button
                              key={`${index}-${delay}`}
                              type="button"
                              onClick={() => {
                                setGifIsPlaying(false);
                                setGifFrameIndex(index);
                              }}
                              className={`flex min-h-16 flex-col justify-between rounded-xl border p-2 text-left transition-colors ${isActive ? 'border-orange-500 bg-orange-500/10' : 'border-zinc-800 bg-zinc-950/70 hover:border-zinc-700 hover:bg-zinc-900/80'}`}
                            >
                              <span className={`text-[10px] font-bold uppercase tracking-widest ${isActive ? 'text-orange-400' : 'text-zinc-400'}`}>
                                {index + 1}
                              </span>
                              <span className="text-[10px] font-mono text-zinc-500">{delay}ms</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={shouldReduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 flex items-center justify-center bg-[#050505] bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-zinc-900/20 via-black to-black"
              >
                <p className="absolute right-12 origin-center rotate-90 transform font-mono text-sm uppercase tracking-widest text-zinc-800">
                  Waiting for Input_
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

      </main>
    </div>
  );
};

export default App;
