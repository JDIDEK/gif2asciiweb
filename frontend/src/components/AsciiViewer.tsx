import React, { useEffect, useRef } from 'react';
import type { AsciiPixel } from '../types/ascii';

interface Props {
  frames: AsciiPixel[][];
  currentFrame: number;
  width: number;
  isDarkMode: boolean;
}

export const AsciiViewer: React.FC<Props> = ({ frames, currentFrame, width, isDarkMode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const frame = frames[currentFrame];
    
    // Vérification que la frame existe et contient des pixels
    if (!frame || frame.length === 0) return;

    // Calcul de la vraie hauteur
    const actualHeight = Math.floor(frame.length / width);
    if (actualHeight === 0) return;

    // Configuration de la police
    const fontSize = 10;
    const charWidth = 6; // Ratio standard monospace
    const charHeight = 10;

    // Redimensionnement du canvas
    canvas.width = width * charWidth;
    canvas.height = actualHeight * charHeight;

    // Remplissage du fond
    ctx.fillStyle = isDarkMode ? '#000000' : '#f4f4f5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textBaseline = 'top';

    // Rendu des pixels
    for (let i = 0; i < frame.length; i++) {
      const pixel = frame[i];
      
      if (!pixel || !pixel.character || pixel.character === ' ') continue;

      const x = (i % width) * charWidth;
      const y = Math.floor(i / width) * charHeight;

      ctx.fillStyle = `rgb(${pixel.red}, ${pixel.green}, ${pixel.blue})`;
      ctx.fillText(pixel.character, x, y);
    }

  }, [frames, currentFrame, width, isDarkMode]);

  if (!frames || frames.length === 0) return null;

  return (
    <div className="flex justify-center items-center w-full h-full overflow-hidden">
      <canvas 
        ref={canvasRef} 
        className="max-w-full rounded shadow-lg border border-zinc-800/50 min-h-50"
        style={{ 
          imageRendering: 'pixelated',
          height: 'auto' 
        }}
      />
    </div>
  );
};