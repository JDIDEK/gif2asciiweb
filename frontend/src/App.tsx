import React, { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import init, { process_image_to_ascii, process_gif_to_ascii_color, encode_gif_from_pixels } from "wasm-core";
import type { AsciiPixel } from './types/ascii';
import { AsciiViewer } from './components/AsciiViewer';

const App: React.FC = () => {
  const [gifFrames, setGifFrames] = useState<AsciiPixel[][]>([]);
  const [staticAscii, setStaticAscii] = useState<string>("");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [width, setWidth] = useState(100);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => { init(); }, []);

  useEffect(() => {
    if (gifFrames.length > 0) {
      const interval = setInterval(() => {
        setCurrentFrame((prev) => (prev + 1) % gifFrames.length);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gifFrames.length]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setGifFrames([]);
    setStaticAscii("");
    setCurrentFrame(0);
    setIsLoading(true);

    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      if (file.type === "image/gif") {
        const result = await process_gif_to_ascii_color(bytes, width);
        setGifFrames(result as AsciiPixel[][]);
      } else {
        const result = await process_image_to_ascii(bytes, width);
        setStaticAscii(result);
      }
    } catch (err) {
      console.error("Erreur WASM:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (gifFrames.length === 0) return;
    setIsExporting(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 50)); 

      const frameHeight = Math.floor(gifFrames[0].length / width);
      const fontSize = 10;
      const charWidth = 6;
      const charHeight = 10;
      
      const canvasWidth = width * charWidth;
      const canvasHeight = frameHeight * charHeight;
      
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("Erreur de contexte 2D");

      const totalPixels = canvasWidth * canvasHeight * 4 * gifFrames.length;
      const flatPixels = new Uint8Array(totalPixels);

      for (let f = 0; f < gifFrames.length; f++) {
        const frame = gifFrames[f];
        
        ctx.fillStyle = isDarkMode ? '#000000' : '#f4f4f5';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textBaseline = 'top';

        for (let i = 0; i < frame.length; i++) {
          const pixel = frame[i];
          if (!pixel || !pixel.character || pixel.character === ' ') continue;
          
          const x = (i % width) * charWidth;
          const y = Math.floor(i / width) * charHeight;
          ctx.fillStyle = `rgb(${pixel.red}, ${pixel.green}, ${pixel.blue})`;
          ctx.fillText(pixel.character, x, y);
        }

        const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
        flatPixels.set(imageData.data, f * canvasWidth * canvasHeight * 4);
      }

      const gifBytes = encode_gif_from_pixels(flatPixels, canvasWidth, canvasHeight, gifFrames.length, 100);

      const blob = new Blob([gifBytes], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fig2tig_masterpiece.gif';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error("Erreur Export:", err);
      alert("Une erreur est survenue lors de l'encodage du GIF.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={`min-h-screen transition-colors ${isDarkMode ? 'bg-zinc-950 text-white' : 'bg-zinc-50 text-zinc-900'}`}>
      <div className="max-w-5xl mx-auto p-8">
        
        <header className="flex justify-between items-center mb-12">
          <h1 className="text-4xl font-black tracking-tighter text-orange-500">FIG2TIG</h1>
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 border rounded-lg text-xs font-bold">
            {isDarkMode ? '🌙 DARK' : '☀️ LIGHT'}
          </button>
        </header>

        <div className={`p-6 rounded-2xl border mb-8 ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
          <div className="flex flex-col md:flex-row gap-6 items-center">
            <input type="file" onChange={handleFile} className="text-sm cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-orange-500 file:text-white" />
            <div className="flex-1 w-full">
              <label className="text-[10px] uppercase opacity-50 font-bold">Width: {width}px</label>
              <input type="range" min="40" max="150" value={width} onChange={(e) => setWidth(parseInt(e.target.value))} className="w-full accent-orange-500" />
            </div>
          </div>
          
          <div className="flex justify-end mt-4 pt-4 border-t border-zinc-500/20">
            <button 
              onClick={handleExport}
              disabled={isExporting || gifFrames.length === 0}
              className={`px-6 py-2 rounded-lg font-bold text-xs uppercase transition-all
                ${gifFrames.length === 0 ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed border border-transparent' 
                : isExporting ? 'bg-orange-500/50 text-white animate-pulse border border-orange-500' 
                : 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg hover:shadow-orange-500/20 border border-transparent'}`}
            >
              {isExporting ? 'RUST ENCODING...' : 'EXPORTER EN GIF'}
            </button>
          </div>
        </div>

        <div className={`rounded-xl p-8 overflow-hidden min-h-75 flex items-center justify-center border ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-zinc-100 border-zinc-200'}`}>
          {isLoading ? (
            <div className="animate-pulse font-mono text-zinc-500 uppercase text-xs">Processing via Rust...</div>
          ) : (
            <>
              {staticAscii && <pre className="font-mono text-[6px] leading-1.25">{staticAscii}</pre>}
              <AsciiViewer frames={gifFrames} currentFrame={currentFrame} width={width} isDarkMode={isDarkMode} />
            </>
          )}
        </div>
        
      </div>
    </div>
  );
};

export default App;