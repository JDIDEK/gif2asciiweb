import React, { useState, useEffect } from 'react';

interface Props {
  text: string;
  className?: string;
}

export const AsciiTextScramble: React.FC<Props> = ({ text, className = "" }) => {
  const chars = '@#$%&8WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. ';
  
  // On initialise en brouillant TOUT, sauf les espaces et les sauts de ligne !
  const [displayText, setDisplayText] = useState(() => 
    text.split('').map(char => 
      (char === ' ' || char === '\n') ? char : chars[Math.floor(Math.random() * chars.length)]
    ).join('')
  );

  useEffect(() => {
    let iteration = 0;
    let interval: ReturnType<typeof setInterval>;
    
    // Vitesse adaptée pour un grand bloc d'ASCII Art
    const increment = text.length / 40; 

    const timeout = setTimeout(() => {
      interval = setInterval(() => {
        setDisplayText((prev) =>
          text
            .split('')
            .map((letter, index) => {
              // Protéger la forme du dessin
              if (letter === ' ' || letter === '\n') return letter;
              
              if (index < iteration) {
                return text[index];
              }
              return chars[Math.floor(Math.random() * chars.length)];
            })
            .join('')
        );

        if (iteration >= text.length) {
          clearInterval(interval);
        }

        iteration += increment; 
      }, 30);
    }, 800); 

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [text]);

  return <pre className={`font-mono whitespace-pre ${className}`}>{displayText}</pre>;
};