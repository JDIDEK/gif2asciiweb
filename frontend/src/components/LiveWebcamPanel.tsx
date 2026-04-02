import React, { useEffect, useRef, useState } from 'react';

export type LiveGesture = 'next_preset' | 'prev_preset' | 'increase_capture' | 'decrease_capture';

interface Props {
  isWasmReady: boolean;
  onFrame: (animation: Uint8Array | null, sourceWidth?: number, sourceHeight?: number) => void;
  onGesture?: (gesture: LiveGesture) => void;
}

const MAX_CAPTURE_WIDTH = 640;
const PINCH_CLOSE_RATIO = 0.38;
const PINCH_OPEN_RATIO = 0.65;
const GESTURE_STABLE_FRAMES = 4;

export const LiveWebcamPanel: React.FC<Props> = ({ isWasmReady, onFrame, onGesture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const handLandmarkerRef = useRef<{
    detectForVideo: (video: HTMLVideoElement, nowMs: number) => { landmarks?: Array<Array<{ x: number; y: number }>> };
    close?: () => void;
  } | null>(null);
  const lastHandDetectAtRef = useRef(0);
  const lastGestureAtRef = useRef(0);
  const stableGestureRef = useRef<LiveGesture | null>(null);
  const stableGestureCountRef = useRef(0);
  const [isEnabled, setIsEnabled] = useState(false);
  const [gesturesEnabled, setGesturesEnabled] = useState(false);
  const [status, setStatus] = useState('Webcam inactive');
  const [gestureStatus, setGestureStatus] = useState('Gestures off');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const classifyGesture = (landmarks: Array<{ x: number; y: number }>): LiveGesture | null => {
    const fingerExtended = (tipIndex: number, pipIndex: number, mcpIndex: number) => {
      const tip = landmarks[tipIndex];
      const pip = landmarks[pipIndex];
      const mcp = landmarks[mcpIndex];
      if (!tip || !pip || !mcp) return false;
      return tip.y < pip.y && pip.y < mcp.y;
    };

    const indexUp = fingerExtended(8, 6, 5);
    const middleUp = fingerExtended(12, 10, 9);
    const ringUp = fingerExtended(16, 14, 13);
    const pinkyUp = fingerExtended(20, 18, 17);

    if (indexUp && middleUp && ringUp && pinkyUp) return 'next_preset';
    if (!indexUp && !middleUp && !ringUp && !pinkyUp) return 'prev_preset';

    // Pinch resize only in index-only pose to avoid confusion with a closed fist.
    if (!indexUp || middleUp || ringUp || pinkyUp) return null;

    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    if (!thumbTip || !indexTip || !wrist || !middleMcp) return null;

    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    const pinchDistance = Math.hypot(dx, dy);

    const palmDx = wrist.x - middleMcp.x;
    const palmDy = wrist.y - middleMcp.y;
    const palmSize = Math.max(0.0001, Math.hypot(palmDx, palmDy));
    const pinchRatio = pinchDistance / palmSize;

    if (pinchRatio <= PINCH_CLOSE_RATIO) return 'decrease_capture';
    if (pinchRatio >= PINCH_OPEN_RATIO) return 'increase_capture';

    return null;
  };

  const detectGesture = (video: HTMLVideoElement) => {
    if (!gesturesEnabled) return;

    const handLandmarker = handLandmarkerRef.current;
    if (!handLandmarker) return;

    const now = performance.now();
    if (now - lastHandDetectAtRef.current < 120) return;
    lastHandDetectAtRef.current = now;

    const result = handLandmarker.detectForVideo(video, now);
    const landmarks = result.landmarks?.[0];
    if (!landmarks || landmarks.length === 0) {
      stableGestureRef.current = null;
      stableGestureCountRef.current = 0;
      return;
    }

    const gesture = classifyGesture(landmarks);
    if (!gesture) {
      stableGestureRef.current = null;
      stableGestureCountRef.current = 0;
      return;
    }

    if (stableGestureRef.current === gesture) {
      stableGestureCountRef.current += 1;
    } else {
      stableGestureRef.current = gesture;
      stableGestureCountRef.current = 1;
    }

    if (stableGestureCountRef.current < GESTURE_STABLE_FRAMES) return;

    const nowMs = Date.now();
    if (nowMs - lastGestureAtRef.current < 1000) return;
    lastGestureAtRef.current = nowMs;
    stableGestureRef.current = null;
    stableGestureCountRef.current = 0;

    const label =
      gesture === 'next_preset'
        ? 'Open palm -> Next preset'
        : gesture === 'prev_preset'
          ? 'Fist -> Previous preset'
          : gesture === 'increase_capture'
            ? 'Fingers spread -> Bigger capture'
            : 'Fingers close -> Smaller capture';

    setGestureStatus(label);
    onGesture?.(gesture);
  };

  const initHandTracking = async () => {
    if (handLandmarkerRef.current) return;

    try {
      setGestureStatus('Loading gestures...');
      const vision = await import('@mediapipe/tasks-vision');
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
      );

      handLandmarkerRef.current = await vision.HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
        },
        numHands: 1,
        runningMode: 'VIDEO'
      });

      setGestureStatus('Gestures ready');
    } catch {
      handLandmarkerRef.current = null;
      setGestureStatus('Gestures unavailable');
    }
  };

  const stopCamera = () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }

    handLandmarkerRef.current?.close?.();
    handLandmarkerRef.current = null;
    stableGestureRef.current = null;
    stableGestureCountRef.current = 0;

    busyRef.current = false;
    setGestureStatus('Gestures off');
    setStatus('Webcam inactive');
    onFrame(null);
  };

  useEffect(() => {
    if (!isWasmReady || !isEnabled) {
      stopCamera();
      return undefined;
    }

    let cancelled = false;

    const startCamera = async () => {
      try {
        setErrorMessage(null);
        setStatus('Requesting webcam access');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          throw new Error('Video webcam indisponible');
        }

        video.srcObject = stream;
        await video.play();
        if (gesturesEnabled) {
          await initHandTracking();
        } else {
          setGestureStatus('Gestures off');
        }
        setStatus('Webcam active');

        const tick = () => {
          if (cancelled) return;
          void captureFrame();
          rafRef.current = window.requestAnimationFrame(tick);
        };

        rafRef.current = window.requestAnimationFrame(tick);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Impossible de démarrer la webcam');
          setStatus('Webcam inactive');
          setIsEnabled(false);
          onFrame(null);
        }
      }
    };

    const captureFrame = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !streamRef.current || busyRef.current) return;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
        return;
      }

      busyRef.current = true;
      try {
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        const targetWidth = sourceWidth > MAX_CAPTURE_WIDTH ? MAX_CAPTURE_WIDTH : sourceWidth;
        const targetHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * targetWidth));

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        onFrame(new Uint8Array(imageData.data), canvas.width, canvas.height);
        detectGesture(video);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Erreur webcam');
          setIsEnabled(false);
        }
      } finally {
        busyRef.current = false;
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [gesturesEnabled, isEnabled, isWasmReady, onFrame, onGesture]);

  return (
    <div className="space-y-3 border border-zinc-300 bg-white p-4">
      <div className="flex items-center justify-between gap-3 text-[10px] uppercase font-mono text-zinc-500">
        <span>Live Webcam</span>
        <span>{status}</span>
      </div>

      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{gestureStatus}</div>

      <button
        type="button"
        onClick={() => {
          setErrorMessage(null);
          setIsEnabled((current) => !current);
        }}
        disabled={!isWasmReady}
        className={`w-full rounded-none border px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors ${isEnabled ? 'border-zinc-900 bg-zinc-100 text-zinc-900' : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-900 hover:text-zinc-900'} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {isEnabled ? 'Stop Webcam' : 'Start Webcam'}
      </button>

      <button
        type="button"
        onClick={() => setGesturesEnabled((current) => !current)}
        disabled={!isWasmReady}
        className={`w-full rounded-none border px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors ${gesturesEnabled ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-900 hover:text-zinc-900'} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {gesturesEnabled ? 'Gestures On' : 'Gestures Off'}
      </button>

      <p className="text-[10px] uppercase tracking-widest text-zinc-500">
        Webcam mode turns your camera into a live ASCII preview.
      </p>
      <p className="text-[10px] uppercase tracking-widest text-zinc-500">
        Presets: open palm = next, fist = previous. Pinch with thumb+index (index up): close = smaller capture, spread = bigger capture.
      </p>

      {errorMessage && <p className="text-[10px] uppercase tracking-widest text-red-400">{errorMessage}</p>}

      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
