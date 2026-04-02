import React, { useEffect, useRef, useState } from 'react';

export type LiveGesture = 'next_preset' | 'prev_preset' | 'increase_capture' | 'decrease_capture';

interface Props {
  isWasmReady: boolean;
  onFrame: (animation: Uint8Array | null, sourceWidth?: number, sourceHeight?: number) => void;
  onGesture?: (gesture: LiveGesture) => void;
}

const MAX_CAPTURE_WIDTH = 640;
const GESTURE_STABLE_FRAMES = 4;
const FACE_DETECT_INTERVAL_MS = 200;
const FACE_BLUR_RADIUS_PX = 12;

type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  detectedAtMs: number;
};

export const LiveWebcamPanel: React.FC<Props> = ({ isWasmReady, onFrame, onGesture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const blurBufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const handLandmarkerRef = useRef<{
    detectForVideo: (video: HTMLVideoElement, nowMs: number) => { landmarks?: Array<Array<{ x: number; y: number }>> };
    close?: () => void;
  } | null>(null);
  const faceDetectorRef = useRef<{
    detectForVideo: (video: HTMLVideoElement, nowMs: number) => {
      detections?: Array<{ boundingBox?: { originX: number; originY: number; width: number; height: number } }>;
    };
    close?: () => void;
  } | null>(null);
  const detectedFaceRef = useRef<FaceBox | null>(null);
  const lastHandDetectAtRef = useRef(0);
  const lastFaceDetectAtRef = useRef(0);
  const lastGestureAtRef = useRef(0);
  const stableGestureRef = useRef<LiveGesture | null>(null);
  const stableGestureCountRef = useRef(0);
  const [isEnabled, setIsEnabled] = useState(false);
  const [gesturesEnabled, setGesturesEnabled] = useState(false);
  const [status, setStatus] = useState('Webcam inactive');
  const [gestureStatus, setGestureStatus] = useState('Gestures off');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const classifyHandPose = (landmarks: Array<{ x: number; y: number }>): 'PALM' | 'FIST' | 'NONE' => {
    if (landmarks.length === 0 || Math.max(...landmarks.map((point) => point.y)) - Math.min(...landmarks.map((point) => point.y)) < 0.08) {
      return 'NONE';
    }

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

    if (indexUp && middleUp && ringUp && pinkyUp) return 'PALM';
    if (!indexUp && !middleUp && !ringUp && !pinkyUp) return 'FIST';
    return 'NONE';
  };

  const detectGesture = (video: HTMLVideoElement) => {
    if (!gesturesEnabled) return;

    const handLandmarker = handLandmarkerRef.current;
    if (!handLandmarker) return;

    const now = performance.now();
    if (now - lastHandDetectAtRef.current < 120) return;
    lastHandDetectAtRef.current = now;

    const result = handLandmarker.detectForVideo(video, now);
    const allLandmarks = result.landmarks ?? [];
    if (allLandmarks.length === 0) {
      stableGestureRef.current = null;
      stableGestureCountRef.current = 0;
      setGestureStatus('Gestures ready');
      return;
    }

    const poses = allLandmarks.map((landmarks) => classifyHandPose(landmarks)).filter((pose) => pose !== 'NONE');

    let gesture: LiveGesture | null = null;
    if (poses.length >= 2) {
      if (poses[0] === 'PALM' && poses[1] === 'PALM') {
        gesture = 'increase_capture';
      } else if (poses[0] === 'FIST' && poses[1] === 'FIST') {
        gesture = 'decrease_capture';
      }
    } else if (poses.length === 1) {
      if (poses[0] === 'PALM') {
        gesture = 'next_preset';
      } else if (poses[0] === 'FIST') {
        gesture = 'prev_preset';
      }
    }

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
        ? 'Palm (1 hand) -> Next render'
        : gesture === 'prev_preset'
          ? 'Fist (1 hand) -> Previous render'
          : gesture === 'increase_capture'
            ? 'Two palms -> Bigger capture'
            : 'Two fists -> Smaller capture';

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
        numHands: 2,
        runningMode: 'VIDEO'
      });

      setGestureStatus('Gestures ready');
    } catch {
      handLandmarkerRef.current = null;
      setGestureStatus('Gestures unavailable');
    }
  };

  const initFaceTracking = async () => {
    if (faceDetectorRef.current) return;

    try {
      const vision = await import('@mediapipe/tasks-vision');
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
      );

      faceDetectorRef.current = await vision.FaceDetector.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
        },
        runningMode: 'VIDEO'
      });
    } catch {
      faceDetectorRef.current = null;
    }
  };

  const detectFace = (video: HTMLVideoElement, targetWidth: number, targetHeight: number) => {
    const faceDetector = faceDetectorRef.current;
    if (!faceDetector) return;

    const now = performance.now();
    if (now - lastFaceDetectAtRef.current < FACE_DETECT_INTERVAL_MS) return;
    lastFaceDetectAtRef.current = now;

    let result: { detections?: Array<{ boundingBox?: { originX: number; originY: number; width: number; height: number } }> };
    try {
      result = faceDetector.detectForVideo(video, now);
    } catch {
      return;
    }

    const box = result.detections?.[0]?.boundingBox;
    if (!box) {
      detectedFaceRef.current = null;
      return;
    }

    const scaleX = targetWidth / video.videoWidth;
    const scaleY = targetHeight / video.videoHeight;
    detectedFaceRef.current = {
      x: box.originX * scaleX,
      y: box.originY * scaleY,
      width: box.width * scaleX,
      height: box.height * scaleY,
      detectedAtMs: Date.now()
    };
  };

  const applyFaceBlur = (ctx: CanvasRenderingContext2D, targetWidth: number, targetHeight: number) => {
    const face = detectedFaceRef.current;
    if (!face) return;
    if (Date.now() - face.detectedAtMs > 700) {
      detectedFaceRef.current = null;
      return;
    }

    const padding = Math.max(6, Math.round(Math.max(face.width, face.height) * 0.18));
    const x = Math.max(0, Math.floor(face.x - padding));
    const y = Math.max(0, Math.floor(face.y - padding));
    const right = Math.min(targetWidth, Math.ceil(face.x + face.width + padding));
    const bottom = Math.min(targetHeight, Math.ceil(face.y + face.height + padding));
    const width = right - x;
    const height = bottom - y;
    if (width < 4 || height < 4) return;

    let blurCanvas = blurBufferCanvasRef.current;
    if (!blurCanvas) {
      blurCanvas = document.createElement('canvas');
      blurBufferCanvasRef.current = blurCanvas;
    }

    blurCanvas.width = width;
    blurCanvas.height = height;
    const blurCtx = blurCanvas.getContext('2d');
    if (!blurCtx) return;

    blurCtx.clearRect(0, 0, width, height);
    blurCtx.drawImage(ctx.canvas, x, y, width, height, 0, 0, width, height);

    ctx.save();
    ctx.filter = `blur(${FACE_BLUR_RADIUS_PX}px)`;
    ctx.drawImage(blurCanvas, x, y, width, height);
    ctx.restore();
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
    faceDetectorRef.current?.close?.();
    faceDetectorRef.current = null;
    detectedFaceRef.current = null;
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
        await initFaceTracking();
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
        detectFace(video, canvas.width, canvas.height);
        applyFaceBlur(ctx, canvas.width, canvas.height);
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
      <p className="text-[10px] uppercase tracking-widest text-zinc-500">Face blur: auto on when a face is detected.</p>
      <p className="text-[10px] uppercase tracking-widest text-zinc-500">
        Render: one-hand palm = next, one-hand fist = previous. Capture: two palms = bigger, two fists = smaller.
      </p>

      {errorMessage && <p className="text-[10px] uppercase tracking-widest text-red-400">{errorMessage}</p>}

      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
