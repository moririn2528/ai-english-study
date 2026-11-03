const NAME = "openai-api-key";

function read(storage: () => Storage): string {
  try {
    return storage().getItem(NAME) ?? "";
  } catch {
    return "";
  }
}

export function loadKey(): string {
  return read(() => sessionStorage) || read(() => localStorage);
}

export function isKeyRemembered(): boolean {
  return read(() => localStorage) !== "";
}

/** The tab-scoped session store is the default; persisting across restarts is opt-in. */
export function saveKey(key: string, remember: boolean): void {
  try {
    sessionStorage.removeItem(NAME);
    localStorage.removeItem(NAME);
    if (key) (remember ? localStorage : sessionStorage).setItem(NAME, key);
  } catch {
    // Storage blocked: the key stays in memory for this page only.
  }
}
