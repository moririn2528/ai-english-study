import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, concatBytes, floatToPcm16, pcm16ToWav } from "./wav";

describe("wav", () => {
  it("writes a valid 44-byte PCM header", () => {
    const wav = pcm16ToWav(new Uint8Array([1, 2, 3, 4]), 24000);
    const v = new DataView(wav.buffer);
    const ascii = (a: number, b: number) => String.fromCharCode(...wav.subarray(a, b));
    expect(wav.length).toBe(48);
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 12)).toBe("WAVE");
    expect(ascii(36, 40)).toBe("data");
    expect(v.getUint32(4, true)).toBe(40);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(28, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(4);
  });

  it("clamps and converts float samples", () => {
    const v = new DataView(floatToPcm16(new Float32Array([0, 1, -1, 2])).buffer);
    expect([0, 2, 4, 6].map((o) => v.getInt16(o, true))).toEqual([0, 32767, -32768, 32767]);
  });

  it("round-trips base64 above the chunk size", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("concatenates chunks in order", () => {
    expect(concatBytes([new Uint8Array([1]), new Uint8Array([2, 3])])).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});
