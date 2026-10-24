/** Storage can be disabled by browser privacy settings. */
export const safeStorage = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* optional preference */ } },
  remove(key: string): void { try { localStorage.removeItem(key); } catch { /* optional preference */ } },
};
