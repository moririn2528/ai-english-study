import { floatToPcm16, pcm16ToWav } from "./wav";
import { loadSpeech, saveSpeech } from "./db";
import { synthesize } from "./openai";

const VOICE_RMS = 0.015;
const SILENCE_POLL_MS = 200;

export interface Recording {
  stop(): Promise<Blob>;
  cancel(): void;
}

export interface RecordOptions {
  /** Called each time this long passes with no voice detected. */
  silenceMs?: number;
  onSilence?: () => void;
}

export async function startRecording(opts: RecordOptions = {}): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  let lastVoice = Date.now();
  const poll = setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    const rms = Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / buffer.length);
    const now = Date.now();
    if (rms > VOICE_RMS) {
      lastVoice = now;
    } else if (opts.silenceMs && opts.onSilence && now - lastVoice >= opts.silenceMs) {
      lastVoice = now;
      opts.onSilence();
    }
  }, SILENCE_POLL_MS);

  const release = () => {
    clearInterval(poll);
    void ctx.close();
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: recorder.mimeType }));
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = release;
      recorder.stop();
    },
  };
}

/** Pronunciation evaluation takes WAV, so browser recordings are re-encoded at 16 kHz mono. */
export async function toWav(audio: Blob): Promise<Blob> {
  const rate = 16000;
  const decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await audio.arrayBuffer());
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const wav = pcm16ToWav(floatToPcm16(rendered.getChannelData(0)), rate);
  return new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
}

async function speechId(text: string, language: string, voice: string): Promise<string> {
  const data = new TextEncoder().encode(`${language}\n${voice}\n${text}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Each sentence is synthesised once, then replayed from IndexedDB at no cost. */
export async function speechFor(
  key: string,
  text: string,
  language: string,
  voice: string,
): Promise<Blob> {
  const id = await speechId(text, language, voice);
  const cached = await loadSpeech(id);
  if (cached) return cached;
  const { audio } = await synthesize(key, text, language, voice);
  await saveSpeech(id, audio);
  return audio;
}

export function play(audio: Blob): Promise<void> {
  const url = URL.createObjectURL(audio);
  const el = new Audio(url);
  return new Promise<void>((resolve, reject) => {
    el.onended = () => resolve();
    el.onerror = () => reject(new Error("音声を再生できませんでした"));
    el.play().catch(reject);
  }).finally(() => URL.revokeObjectURL(url));
}
