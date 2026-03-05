import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AsciiTextScramble } from './AsciiTextScramble';

interface Props {
  isLoaded: boolean;
}

export const customEase = [0.76, 0, 0.24, 1];

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
  return (
    <AnimatePresence>
      {!isLoaded && (
        <motion.div
          exit={{ y: "-100%" }}
          transition={{ duration: 1.2, ease: customEase }}
          className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center"
        >
          <div className="flex flex-col items-center gap-8 overflow-hidden">
            <div className="flex gap-4 text-5xl md:text-7xl font-black tracking-tighter text-white">
              <motion.span
                initial={{ y: "100%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 1, ease: customEase, delay: 0.1 }}
              >
                GIF
              </motion.span>

              <motion.span
                initial={{ y: "100%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 1, ease: customEase, delay: 0.2 }}
                className="text-orange-500 font-serif italic font-light"
              >
                2
              </motion.span>
            </div>

            {/* Le rendu du dessin ASCII Art Animé */}
            <div className="overflow-hidden">
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 1.2, ease: customEase, delay: 0.3 }}
              >
                <AsciiTextScramble 
                  text={BIG_ASCII_ART} 
                  className="text-[8px] sm:text-[10px] md:text-xs lg:text-sm text-zinc-300 leading-[1.1] text-center" 
                />
              </motion.div>
            </div>
          </div>

          <div className="overflow-hidden mt-12">
            <motion.p
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: "0%", opacity: 1 }}
              transition={{ duration: 1, ease: customEase, delay: 0.8 }}
              className="text-zinc-600 font-mono text-[10px] uppercase tracking-[0.3em] flex items-center gap-4"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              Initializing WASM Engine
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};