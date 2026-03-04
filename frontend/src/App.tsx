import React, { useState, useEffect, ChangeEvent } from 'react';
import init, { process_image_to_ascii, process_gif_to_ascii_color } from "wasm-core";

// On définit l'interface pour correspondre à la struct Rust
interface AsciiPixel {
  character: string;
  red: number;
  green: number;
  blue: number;
}

const App: React.FC = () => {
  const [staticAscii, setStaticAscii] = useState<string>("");
  const [gifFrames, setGifFrames] = useState<AsciiPixel[][]>([]);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [width, setWidth] = useState<number>(100);
  const [isWasmLoaded, setIsWasmLoaded] = useState<boolean>(false);
  const [mode, setMode] = useState<'static' | 'gif' | null>(null);

  useEffect(() => {
    init().then(() => setIsWasmLoaded(true));
  }, []);

  // Animation pour les GIFs
  useEffect(() => {
    if (mode === 'gif' && gifFrames.length > 0) {
      const interval = setInterval(() => {
        setCurrentFrame((prev) => (prev + 1) % gifFrames.length);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [mode, gifFrames]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isWasmLoaded) return;

    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      if (file.type === "image/gif") {
        const result = await process_gif_to_ascii_color(bytes, width);
        setGifFrames(result as AsciiPixel[][]);
        setMode('gif');
        setCurrentFrame(0);
      } else {
        const result = await process_image_to_ascii(bytes, width);
        setStaticAscii(result);
        setMode('static');
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-12">
      <header className="mb-12 text-center">
        <h1 className="text-5xl font-black text-orange-500 tracking-tighter">FIG2TIG</h1>
        <p className="text-zinc-500 font-mono text-sm uppercase mt-2">Structured Data Edition</p>
      </header>

      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex gap-4 items-center bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
          <input type="file" onChange={handleFile} accept="image/*" className="flex-1" />
          <div className="flex flex-col">
             <span className="text-[10px] font-bold text-zinc-500 uppercase">Width: {width}</span>
             <input type="range" min="40" max="150" value={width} onChange={(e) => setWidth(parseInt(e.target.value))} />
          </div>
        </div>

        <div className="bg-black border border-zinc-800 rounded-xl p-8 overflow-hidden flex justify-center">
          {mode === 'static' && (
            <pre className="font-mono text-[6px] leading-[5px] text-white">
              {staticAscii}
            </pre>
          )}

          {mode === 'gif' && gifFrames.length > 0 && (
            <pre className="font-mono text-[6px] leading-[5px] whitespace-pre">
              {/* On map sur les pixels de la frame actuelle */}
              {gifFrames[currentFrame].map((pixel, i) => (
                <React.Fragment key={i}>
                  <span style={{ color: `rgb(${pixel.red},${pixel.green},${pixel.blue})` }}>
                    {pixel.character}
                  </span>
                  {/* On ajoute un retour à la ligne tous les 'width' pixels */}
                  {(i + 1) % width === 0 && "\n"}
                </React.Fragment>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;