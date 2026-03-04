import React from 'react';
import type { AsciiPixel } from '../types/ascii';

interface Props {
    frames: AsciiPixel[][];
    currentFrame: number;
    width: number;
    isDarkMode: boolean;
}

export const AsciiViewer: React.FC<Props> = ({ frames, currentFrame, width, isDarkMode }) => {
    const frame = frames[currentFrame];

    if (!frame) return null;

    return (
    <pre className="font-mono text-[4px] md:text-[6px] leading-[3px] md:leading-[5px] whitespace-pre">
      {frame.map((pixel, i) => (
        <React.Fragment key={i}>
          <span style={{ color: `rgb(${pixel.red},${pixel.green},${pixel.blue})` }}>
            {pixel.character}
          </span>
          {(i + 1) % width === 0 && "\n"}
        </React.Fragment>
      ))}
    </pre>
  );
};