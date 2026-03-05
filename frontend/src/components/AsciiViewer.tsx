import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { PackedAsciiAnimation } from '../types/ascii';

interface Props {
  animation: PackedAsciiAnimation | null;
  isDarkMode: boolean;
  frameDelayMs?: number;
}

const FONT_SIZE = 10;
const CHAR_WIDTH = 6;
const CHAR_HEIGHT = 10;

const CHAR_CACHE = Array.from({ length: 256 }, (_, index) => String.fromCharCode(index));

function drawAsciiFrame(
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
    if (charCode === 32 || charCode === 0) continue;

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

export const AsciiViewer: React.FC<Props> = ({ animation, isDarkMode, frameDelayMs = 100 }) => {
  const shouldReduceMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !animation || animation.frameCount === 0) return;

    const canvasWidth = animation.width * CHAR_WIDTH;
    const canvasHeight = animation.height * CHAR_HEIGHT;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let frameIndex = 0;
    let last = performance.now();
    let accumulator = 0;

    drawAsciiFrame(ctx, animation, frameIndex, canvasWidth, canvasHeight, isDarkMode);

    const tick = (now: number) => {
      accumulator += now - last;
      last = now;

      let activeDelay = animation.delaysMs[frameIndex] || frameDelayMs;
      while (accumulator >= activeDelay) {
        accumulator -= activeDelay;
        frameIndex = (frameIndex + 1) % animation.frameCount;
        activeDelay = animation.delaysMs[frameIndex] || frameDelayMs;
      }

      drawAsciiFrame(ctx, animation, frameIndex, canvasWidth, canvasHeight, isDarkMode);
      rafId = requestAnimationFrame(tick);
    };

    if (!shouldReduceMotion && animation.frameCount > 1) {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [animation, frameDelayMs, isDarkMode, shouldReduceMotion]);

  if (!animation || animation.frameCount === 0) return null;

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={animation.frameCount > 1 ? 'Animated ASCII Preview' : 'ASCII Preview'}
        className="min-h-50 max-w-full rounded border border-zinc-800/50 shadow-lg"
        style={{
          imageRendering: 'pixelated',
          height: 'auto'
        }}
      />
    </div>
  );
};
