import type { Attempt, Candidate, Material, Retro, ReviewItem, Settings, Vote } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const DB_NAME = "language-practice";
const STORES = ["materials", "reviews", "retros", "speech", "kv"] as const;
type Store = (typeof STORES)[number];

let opened: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store: Store, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(store, mode).objectStore(store);
}

async function all<T>(store: Store): Promise<T[]> {
  return wrap((await tx(store, "readonly")).getAll() as IDBRequest<T[]>);
}

async function get<T>(store: Store, key: string): Promise<T | undefined> {
  return wrap((await tx(store, "readonly")).get(key) as IDBRequest<T | undefined>);
}

async function put(store: Store, key: string, value: unknown): Promise<void> {
  await wrap((await tx(store, "readwrite")).put(value, key));
}

const newestFirst = <T extends { createdAt: number }>(rows: T[]) =>
  rows.sort((a, b) => b.createdAt - a.createdAt);

export const loadMaterials = async () => newestFirst(await all<Material>("materials"));
export const saveMaterial = (m: Material) => put("materials", m.id, m);
export const loadReviews = async () => newestFirst(await all<ReviewItem>("reviews"));
export const saveReview = (r: ReviewItem) => put("reviews", r.id, r);
export const loadRetros = async () => newestFirst(await all<Retro>("retros"));
export const saveRetro = (r: Retro) => put("retros", r.id, r);

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await get<Partial<Settings>>("kv", "settings")) };
}
export const saveSettings = (s: Settings) => put("kv", "settings", s);

const MAX_VOTES = 200;
const MAX_ATTEMPTS = 300;
const MAX_SEEN = 300;

export const loadVotes = async () => (await get<Vote[]>("kv", "votes")) ?? [];
export const saveVotes = (v: Vote[]) => put("kv", "votes", v.slice(-MAX_VOTES));
export const loadAttempts = async () => (await get<Attempt[]>("kv", "attempts")) ?? [];
export async function addAttempt(a: Attempt): Promise<Attempt[]> {
  const next = [...(await loadAttempts()), a].slice(-MAX_ATTEMPTS);
  await put("kv", "attempts", next);
  return next;
}
/** The last shown candidates, so leaving the tab does not lose them. */
export const loadCandidates = async () => (await get<Candidate[]>("kv", "candidates")) ?? [];
export const saveCandidates = (c: Candidate[]) => put("kv", "candidates", c);
/** URLs already suggested, excluded from the next search. */
export const loadSeen = async () => (await get<string[]>("kv", "seen")) ?? [];
export const saveSeen = (urls: string[]) => put("kv", "seen", [...new Set(urls)].slice(-MAX_SEEN));

export const loadSpeech = (id: string) => get<Blob>("speech", id);
export const saveSpeech = (id: string, audio: Blob) => put("speech", id, audio);

export interface Backup {
  version: 1;
  settings: Settings;
  materials: Material[];
  reviews: ReviewItem[];
  retros: Retro[];
  votes?: Vote[];
  attempts?: Attempt[];
}

/** Excludes the API key and regenerable speech audio. */
export async function exportBackup(): Promise<Backup> {
  return {
    version: 1,
    settings: await loadSettings(),
    materials: await loadMaterials(),
    reviews: await loadReviews(),
    retros: await loadRetros(),
    votes: await loadVotes(),
    attempts: await loadAttempts(),
  };
}

export async function importBackup(b: Backup): Promise<void> {
  if (b.version !== 1) throw new Error("対応していないバックアップ形式です");
  await saveSettings(b.settings);
  await Promise.all([
    ...b.materials.map(saveMaterial),
    ...b.reviews.map(saveReview),
    ...b.retros.map(saveRetro),
    ...(b.votes ? [saveVotes(b.votes)] : []),
    ...(b.attempts ? [put("kv", "attempts", b.attempts.slice(-MAX_ATTEMPTS))] : []),
  ]);
}
