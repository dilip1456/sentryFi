/**
 * Shared vi.mock factories. The real supabase client throws at import when
 * VITE_SUPABASE_URL is unset, and tests must never talk to a real project,
 * so every QA test that imports app components mocks it with an inert stub.
 */
import { vi } from "vitest";

export function inertSupabase() {
  const result = { data: [], error: null, count: 0 };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select","insert","update","upsert","delete","eq","neq","in","is","gte","lte","gt","lt","order","range","limit","match","not","or","filter","contains"]) chain[m] = vi.fn(self);
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (res: (v: typeof result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), unsubscribe: vi.fn() })),
      removeChannel: vi.fn(),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        signOut: vi.fn(async () => ({ error: null })),
      },
    },
  };
}
