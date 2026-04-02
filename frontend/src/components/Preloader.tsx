import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { AsciiTextScramble } from './AsciiTextScramble';
import { customEase } from '../lib/motion';

interface Props {
  isLoaded: boolean;
}

// Le mot ASCII dessiné en véritable ASCII Art !
const BIG_ASCII_ART = `
  @@@@@   @@@@@@   @@@@@@  @@@ @@@ 
 @@@@@@@ @@@@@@@@ @@@@@@@@ @@@ @@@ 
 @@!  @@ @@!      @@!      @@! @@! 
 !@!  @! !@!      !@!      !@! !@! 
 @!@!@!@ !!@!!!   @!!      !!@ !!@ 
 !!!@!!!     !:!  !!!      !!! !!! 
 !!:  !!! !!: :!! !!:  !!! !!: !!: 
 :!:  !:! :!: :!: :!:  !:! :!: :!: 
  ::   ::  ::: ::  ::: :::  ::  :: 
`.replace(/^\n/, '');

export const Preloader: React.FC<Props> = ({ isLoaded }) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {!isLoaded && (
        <motion.div
          exit={shouldReduceMotion ? { opacity: 0 } : { y: '-100%' }}
          transition={{ duration: shouldReduceMotion ? 0.2 : 1.3, ease: customEase }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black"
        >
          <div className="flex flex-col items-center gap-8 overflow-hidden">
            <div className="flex gap-4 text-5xl md:text-7xl font-black tracking-tighter text-white">
              <motion.span
                initial={shouldReduceMotion ? false : { y: '100%' }}
                animate={{ y: '0%' }}
                transition={{ duration: shouldReduceMotion ? 0.2 : 1.1, ease: customEase, delay: shouldReduceMotion ? 0 : 0.1 }}
              >
                GIF
              </motion.span>

              <motion.span
                initial={shouldReduceMotion ? false : { y: '100%' }}
                animate={{ y: '0%' }}
                transition={{ duration: shouldReduceMotion ? 0.2 : 1.1, ease: customEase, delay: shouldReduceMotion ? 0 : 0.2 }}
                className="text-orange-500 font-serif italic font-light"
              >
                2
              </motion.span>
            </div>

            {/* Le rendu du dessin ASCII Art Animé */}
            <div className="overflow-hidden">
              <motion.div
                initial={shouldReduceMotion ? false : { y: '100%' }}
                animate={{ y: '0%' }}
                transition={{ duration: shouldReduceMotion ? 0.2 : 1.25, ease: customEase, delay: shouldReduceMotion ? 0 : 0.32 }}
              >
                <AsciiTextScramble 
                  text={BIG_ASCII_ART} 
                  startDelayMs={shouldReduceMotion ? 0 : 280}
                  tickMs={shouldReduceMotion ? 24 : 46}
                  revealDurationMs={shouldReduceMotion ? 220 : 2600}
                  className="text-[8px] sm:text-[10px] md:text-xs lg:text-sm text-zinc-300 leading-[1.1] text-center" 
                />
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
