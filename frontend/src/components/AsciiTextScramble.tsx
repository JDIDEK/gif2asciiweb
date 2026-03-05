import React, { useState, useEffect } from 'react';
import { useReducedMotion } from 'motion/react';

interface Props {
  text: string;
  className?: string;
}

function scrambleText(text: string, chars: string) {
  return text
    .split('')
    .map((char) =>
      (char === ' ' || char === '\n') ? char : chars[Math.floor(Math.random() * chars.length)]
    )
    .join('');
}

export const AsciiTextScramble: React.FC<Props> = ({ text, className = "" }) => {
  const shouldReduceMotion = useReducedMotion();
  const chars = '@#$%&8WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. ';
  
  // On initialise en brouillant TOUT, sauf les espaces et les sauts de ligne !
  const [displayText, setDisplayText] = useState(() => scrambleText(text, chars));

  useEffect(() => {
    if (shouldReduceMotion) return;

    let iteration = 0;
    let intervalId = 0;
    const targetChars = text.split('');
    const resetId = window.requestAnimationFrame(() => {
      setDisplayText(scrambleText(text, chars));
    });
    
    // Vitesse adaptée pour un grand bloc d'ASCII Art
    const increment = text.length / 40; 

    const timeout = setTimeout(() => {
      intervalId = window.setInterval(() => {
        setDisplayText(
          targetChars
            .map((letter, index) => {
              // Protéger la forme du dessin
              if (letter === ' ' || letter === '\n') return letter;
              
              if (index < iteration) {
                return targetChars[index];
              }
              return chars[Math.floor(Math.random() * chars.length)];
            })
            .join('')
        );

        if (iteration >= text.length) {
          clearInterval(intervalId);
        }

        iteration += increment; 
      }, 30);
    }, 800); 

    return () => {
      cancelAnimationFrame(resetId);
      clearTimeout(timeout);
      clearInterval(intervalId);
    };
  }, [chars, shouldReduceMotion, text]);

  return <pre className={`font-mono whitespace-pre ${className}`}>{shouldReduceMotion ? text : displayText}</pre>;
};
