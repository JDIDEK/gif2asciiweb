import React, { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import init, { process_image_to_ascii, process_gif_to_ascii_color } from "wasm-core";
import type { AsciiPixel } from './types/ascii';
import { AsciiViewer } from './components/AsciiViewer';

const App: React.FC = () => {
  const [gifFrames, setGifFrames] = useState<AsciiPixel[][]>([]);
  const [staticAscii, setStaticAscii] = useState<string>("");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [width, setWidth] = useState(100);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

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
            <input type="file" onChange={handleFile} className="text-sm" />
            <div className="flex-1 w-full">
              <label className="text-[10px] uppercase opacity-50 font-bold">Width: {width}px</label>
              <input type="range" min="40" max="150" value={width} onChange={(e) => setWidth(parseInt(e.target.value))} className="w-full accent-orange-500" />
            </div>
          </div>
        </div>

        <div className={`rounded-xl p-8 overflow-hidden min-h-[300px] flex items-center justify-center border ${isDarkMode ? 'bg-black border-zinc-800' : 'bg-zinc-100 border-zinc-200'}`}>
          {isLoading ? (
            <div className="animate-pulse font-mono text-zinc-500 uppercase text-xs">Processing via Rust...</div>
          ) : (
            <>
              {staticAscii && <pre className="font-mono text-[6px] leading-[5px]">{staticAscii}</pre>}
              <AsciiViewer frames={gifFrames} currentFrame={currentFrame} width={width} isDarkMode={isDarkMode} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;