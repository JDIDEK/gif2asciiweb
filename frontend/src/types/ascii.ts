export interface PackedAsciiAnimation {
  width: number;
  height: number;
  frameCount: number;
  chars: Uint8Array;
  rgb: Uint8Array;
  delaysMs: Uint16Array;
}
