export interface PlaybackState {
  position: number;
  speed: number;
  version: 'clean' | 'original';
  updatedAt: number;
}

const PREFIX = 'hushpod:position:';
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function keyFor(episodeId: number | string): string {
  return `${PREFIX}${episodeId}`;
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function load(episodeId: number | string): PlaybackState | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(episodeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlaybackState>;
    if (
      typeof parsed.position !== 'number' ||
      typeof parsed.speed !== 'number' ||
      (parsed.version !== 'clean' && parsed.version !== 'original') ||
      typeof parsed.updatedAt !== 'number'
    ) {
      return null;
    }
    return {
      position: parsed.position,
      speed: parsed.speed,
      version: parsed.version,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function save(episodeId: number | string, state: PlaybackState): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(keyFor(episodeId), JSON.stringify(state));
  } catch {
    /* quota / serialization errors are non-fatal */
  }
}

export function clear(episodeId: number | string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(keyFor(episodeId));
  } catch {
    /* ignore */
  }
}

/**
 * Removes persisted playback entries older than 90 days.
 * Returns the number of entries removed.
 */
export function cleanupStale(now: number = Date.now()): number {
  if (!hasStorage()) return 0;
  let removed = 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Partial<PlaybackState>;
        if (
          typeof parsed.updatedAt !== 'number' ||
          now - parsed.updatedAt > NINETY_DAYS_MS
        ) {
          keysToRemove.push(key);
        }
      } catch {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
      removed++;
    }
  } catch {
    /* ignore */
  }
  return removed;
}
