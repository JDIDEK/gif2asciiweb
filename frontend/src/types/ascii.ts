export interface PackedAsciiAnimation {
  width: number;
  height: number;
  frameCount: number;
  chars: Uint8Array;
  rgb: Uint8Array;
  delaysMs: Uint16Array;
}

export type AsciiRenderPresetId = 'classic' | 'manga' | 'neon' | 'terminal' | 'newspaper' | 'matrix';

export interface AsciiRenderPreset {
  id: AsciiRenderPresetId;
  label: string;
  description: string;
  wasmPreset: string;
  accent: string;
}

export interface SavedAsciiPreset {
  id: string;
  name: string;
  renderPresetId: AsciiRenderPresetId;
  width: number;
}
