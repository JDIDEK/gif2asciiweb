import React, { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import init, { process_gif_to_ascii_color, process_image_to_ascii } from 'wasm-core';
import type { PackedAsciiAnimation } from './types/ascii';

// --- Composants ---
import { AsciiViewer } from './components/AsciiViewer';
import { Preloader, customEase } from './components/Preloader';

// --- UI & Icônes ---
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Download, Settings2, Sparkles } from 'lucide-react';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 16_000_000;
const ALLOWED_MIME_TYPES = new Set(['image/gif', 'image/png', 'image/jpeg', 'image/webp']);
const FRAME_DELAY_MS = 100;
const FONT_SIZE = 10;
const CHAR_WIDTH = 6;
const CHAR_HEIGHT = 10;
const CHAR_CACHE = Array.from({ length: 256 }, (_, index) => String.fromCharCode(index));

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
  const [gifAnimation, setGifAnimation] = useState<PackedAsciiAnimation | null>(null);
  const [staticAscii, setStaticAscii] = useState('');
  const [width, setWidth] = useState(100);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isWasmReady, setIsWasmReady] = useState(false);
  
  // State pour le preloader
  const [appLoaded, setAppLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    
    // Délai de 3 secondes pour laisser l'animation du preloader s'afficher
    const timer = setTimeout(() => {
      if (mounted) setAppLoaded(true);
    }, 3000);

    init()
      .then(() => {
        if (mounted) setIsWasmReady(true);
      })
      .catch((err) => {
        console.error('Erreur init WASM:', err);
        if (mounted) setErrorMessage('Initialisation WASM impossible');
      });

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    if (!isWasmReady) {
      setErrorMessage('Le moteur WASM n’est pas encore prêt.');
      return;
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setErrorMessage('Type de fichier non supporté.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage('Fichier trop volumineux (max 20MB).');
      return;
    }

    setGifAnimation(null);
    setStaticAscii('');
    setIsLoading(true);

    try {
      const bitmap = await createImageBitmap(file);
      const sourcePixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (sourcePixels > MAX_SOURCE_PIXELS) {
        throw new Error('Image trop grande (limite pixels dépassée)');
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (file.type === 'image/gif') {
        const rawResult = await process_gif_to_ascii_color(bytes, width);
        const animation = normalizePackedAnimation(rawResult);
        setGifAnimation(animation);
      } else {
        const result = await process_image_to_ascii(bytes, width);
        setStaticAscii(result);
      }
    } catch (err) {
      console.error('Erreur WASM:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Erreur de traitement du fichier');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (!gifAnimation || isExporting) return;

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
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-orange-500 selection:text-white bg-grain overflow-hidden">
      
      {/* 1. THE AWWARDS PRELOADER */}
      <Preloader isLoaded={appLoaded} />

      {/* 2. THE MAIN LAYOUT */}
      <main className="h-screen w-full flex flex-col lg:flex-row p-4 md:p-8 gap-8 relative z-10">
        
        {/* COLONNE GAUCHE: Contrôles & Typo */}
        <motion.div 
          initial={{ opacity: 0, x: -50 }}
          animate={appLoaded ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 1.2, ease: customEase, delay: 0.4 }}
          className="flex-1 flex flex-col justify-between"
        >
          <header className="pt-4">
            <h1 className="text-6xl md:text-[5.5rem] font-black tracking-tighter leading-[0.85] text-white">
              ASCII <br/> 
              <span className="text-orange-500 italic font-serif font-light tracking-normal">Masterpiece.</span>
            </h1>
            <p className="mt-8 text-zinc-500 font-mono text-xs max-w-sm uppercase leading-relaxed">
              High-performance WebAssembly engine. <br/> converting pixels into typography at 60fps.
            </p>
          </header>

          <div className="space-y-6 mt-12 lg:mt-0 pb-4">
            {/* Panneau de configuration */}
            <div className="group relative border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-md rounded-2xl p-6 transition-all hover:border-zinc-700 hover:bg-zinc-900/50">
              <div className="flex items-center gap-3 mb-8">
                <Settings2 className="w-4 h-4 text-orange-500" />
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Engine Parameters</h3>
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between items-end text-[10px] uppercase font-mono text-zinc-500">
                  <span>Resolution Matrix</span>
                  <span className="text-white text-lg font-sans tracking-tighter leading-none">{width}<span className="text-zinc-600 text-[10px] ml-1">px</span></span>
                </div>
                <input
                  type="range" min="40" max="150"
                  value={width}
                  onChange={(e) => setWidth(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
              </div>
            </div>

            {/* Boutons d'Action Magnétiques */}
            <div className="grid grid-cols-2 gap-4">
              <label className="relative flex flex-col items-center justify-center h-28 border border-zinc-800 border-dashed rounded-2xl cursor-pointer hover:border-orange-500/50 transition-colors group overflow-hidden bg-black/50">
                <input type="file" accept="image/gif,image/png,image/jpeg,image/webp" onChange={handleFile} className="hidden" />
                <motion.div whileHover={{ y: -2 }} className="flex flex-col items-center gap-3">
                  <Upload className="w-5 h-5 text-zinc-500 group-hover:text-orange-400 transition-colors" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 group-hover:text-orange-400 transition-colors">Upload Media</span>
                </motion.div>
                <div className="absolute inset-0 bg-orange-500/5 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out" />
              </label>

              <button
                onClick={handleExport}
                disabled={isExporting || (!gifAnimation && !staticAscii) || !isWasmReady}
                className="relative flex flex-col items-center justify-center h-28 border border-zinc-800 rounded-2xl cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden bg-zinc-900/50 hover:border-orange-500 transition-colors"
              >
                <motion.div whileHover={!isExporting && (gifAnimation || staticAscii) ? { y: -2 } : {}} className="flex flex-col items-center gap-3 relative z-10">
                  {isExporting ? (
                    <Sparkles className="w-5 h-5 text-black animate-pulse" />
                  ) : (
                    <Download className="w-5 h-5 text-orange-500 group-hover:text-black transition-colors" />
                  )}
                  <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${isExporting ? 'text-black' : 'text-zinc-300 group-hover:text-black'}`}>
                    {isExporting ? 'Encoding...' : 'Export GIF'}
                  </span>
                </motion.div>
                <div className="absolute inset-0 bg-orange-500 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out z-0" />
              </button>
            </div>
            
            {errorMessage && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="text-red-400 text-[10px] font-mono p-3 border border-red-900/30 bg-red-950/20 rounded-xl uppercase tracking-wider mt-4">
                <span className="font-bold mr-2">Error:</span> {errorMessage}
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* COLONNE DROITE: Le Canvas (Viewer) */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={appLoaded ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 1.2, ease: customEase, delay: 0.6 }}
          className="flex-[1.8] relative h-[50vh] lg:h-full rounded-4xl overflow-hidden bg-black border border-zinc-800/50 shadow-2xl"
        >
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-black z-20"
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Processing Pixels</p>
                </div>
              </motion.div>
            ) : gifAnimation || staticAscii ? (
              <motion.div
                key="viewer"
                initial={{ clipPath: "polygon(0 100%, 100% 100%, 100% 100%, 0% 100%)" }}
                animate={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0% 100%)" }}
                transition={{ duration: 1.2, ease: customEase }}
                className="absolute inset-0 flex items-center justify-center p-4 bg-zinc-950"
              >
                {staticAscii && <pre className="font-mono text-[5px] leading-tight text-zinc-300">{staticAscii}</pre>}
                {gifAnimation && <AsciiViewer animation={gifAnimation} isDarkMode={true} frameDelayMs={FRAME_DELAY_MS} />}
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="absolute inset-0 flex items-center justify-center bg-[#050505] bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-zinc-900/20 via-black to-black"
              >
                <p className="text-zinc-800 font-mono text-sm uppercase tracking-widest rotate-90 transform origin-center absolute right-12">
                  Waiting for input_
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