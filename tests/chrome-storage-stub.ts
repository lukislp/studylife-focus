// Minimal in-memory stand-in for chrome.storage.local/.session - just enough surface (get/set/
// remove, each keyed by a single string) for connect.ts's pending-connect marker,
// settings.ts/blockConfig.ts's stored records, and pollSnapshot.ts. Cast through `unknown` when
// assigning to globalThis.chrome since @types/chrome's StorageArea type is far wider than what
// these modules actually call - a full mock would just be noise. Mirrors studylife-capture's
// tests/chrome-storage-stub.ts, extended with a second independent store for storage.session.
export function createChromeStorageStub() {
  let local: Record<string, unknown> = {};
  let session: Record<string, unknown> = {};

  function area(store: () => Record<string, unknown>, setStore: (next: Record<string, unknown>) => void) {
    return {
      get: async (key: string) => ({ [key]: store()[key] }),
      set: async (items: Record<string, unknown>) => {
        setStore({ ...store(), ...items });
      },
      remove: async (key: string) => {
        const next = { ...store() };
        delete next[key];
        setStore(next);
      },
    };
  }

  return {
    raw: () => local,
    rawSession: () => session,
    reset: () => {
      local = {};
      session = {};
    },
    install: () => {
      (globalThis as unknown as { chrome: unknown }).chrome = {
        storage: {
          local: area(() => local, (next) => (local = next)),
          session: area(() => session, (next) => (session = next)),
        },
      };
    },
  };
}
