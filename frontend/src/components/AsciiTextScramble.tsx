import React, { useState, useEffect } from 'react';

interface Props {
  text: string;
  className?: string;
  startDelayMs?: number;
  tickMs?: number;
  revealDurationMs?: number;
}

const SCRAMBLE_CHARS = '@#$%&8WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. ';

export const AsciiTextScramble: React.FC<Props> = ({
  text,
  className = '',
  startDelayMs = 400,
  tickMs = 42,
  revealDurationMs = 2000
}) => {
  
  // On initialise en brouillant TOUT, sauf les espaces et les sauts de ligne !
  const [displayText, setDisplayText] = useState(() =>
    text.split('').map((char) =>
      (char === ' ' || char === '\n') ? char : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
    ).join('')
  );

  useEffect(() => {
    let progress = 0;
    let interval: ReturnType<typeof setInterval>;

    const totalTicks = Math.max(1, Math.round(revealDurationMs / tickMs));
    const increment = text.length / totalTicks;

    const timeout = window.setTimeout(() => {
      interval = setInterval(() => {
        setDisplayText(() =>
          text
            .split('')
            .map((letter, index) => {
              if (letter === ' ' || letter === '\n') return letter;

              if (index < progress) {
                return text[index];
              }

              const noiseWeight = Math.min(1, Math.max(0, (index - progress) / 12));
              if (Math.random() > noiseWeight) {
                return text[index];
              }

              return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
            })
            .join('')
        );

        if (progress >= text.length) {
          setDisplayText(text);
          clearInterval(interval);
        }

        progress += increment;
      }, tickMs);
    }, startDelayMs);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [revealDurationMs, startDelayMs, text, tickMs]);

  return <pre className={`font-mono whitespace-pre ${className}`}>{displayText}</pre>;
};