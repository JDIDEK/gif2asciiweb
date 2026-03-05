/// <reference lib="webworker" />

import init, { GifEncodeSession } from 'wasm-core';

type ExportWorkerRequest =
  | { type: 'start'; width: number; height: number }
  | { type: 'frame'; rgba: ArrayBuffer; delayCs: number }
  | { type: 'finish' };

type ExportWorkerResponse =
  | { type: 'done'; gif: ArrayBuffer }
  | { type: 'error'; message: string };

let wasmInitPromise: Promise<unknown> | null = null;
let session: GifEncodeSession | null = null;

async function ensureWasmReady() {
  if (!wasmInitPromise) {
    wasmInitPromise = init();
  }
  await wasmInitPromise;
}

function postError(message: string) {
  const response: ExportWorkerResponse = { type: 'error', message };
  workerScope.postMessage(response);
}

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<ExportWorkerRequest>) => {
  const data = event.data;

  try {
    await ensureWasmReady();

    if (data.type === 'start') {
      session = new GifEncodeSession(data.width, data.height);
      return;
    }

    if (data.type === 'frame') {
      if (!session) throw new Error('Session GIF non initialisée');
      session.push_frame(new Uint8Array(data.rgba), data.delayCs);
      return;
    }

    if (data.type === 'finish') {
      if (!session) throw new Error('Session GIF non initialisée');
      const gifBytes = session.finish();
      session = null;

      const gifBuffer = Uint8Array.from(gifBytes).buffer;

      const response: ExportWorkerResponse = { type: 'done', gif: gifBuffer };
      workerScope.postMessage(response, [gifBuffer]);
      return;
    }

    throw new Error('Message worker inconnu');
  } catch (err) {
    session = null;
    postError(err instanceof Error ? err.message : 'Erreur worker export');
  }
};
