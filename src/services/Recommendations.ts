import { create } from 'zustand';
import { api, OfflineError } from './ApiClient';
import { getDb, hasDb, kvGet, kvSet } from '../data/db';
import { lastAiLang } from './AiNames';
import type { Track } from '../data/library';

export interface Shelf {
  title: string;
  reason: string;
  tracks: Track[];
}

interface ServerSection {
  title: string;
  reason: string;
  track_ids: number[]; // server ids
}
interface ServerRecs {
  sections: ServerSection[];
  ai: boolean;
  generated_at: number;
}

interface State {
  sections: ServerSection[];
  ai: boolean;
  loading: boolean;
  generatedAt: number;
}

export const useRecommendations = create<State>(() => ({ sections: [], ai: false, loading: false, generatedAt: 0 }));

const STALE_MS = 3 * 60 * 60 * 1000;
let inFlight: Promise<void> | null = null;

/** Shows the last feed instantly (works offline), then refreshes it from the server when it is stale. */
export async function loadRecommendations(force = false) {
  if (!hasDb()) return;
  if (!useRecommendations.getState().sections.length) {
    const raw = await kvGet('recs').catch(() => null);
    if (raw) {
      try {
        const r = JSON.parse(raw) as ServerRecs;
        useRecommendations.setState({ sections: r.sections, ai: r.ai, generatedAt: r.generated_at });
      } catch {
        // a corrupt cache is simply refetched
      }
    }
  }
  if (!force && Date.now() - useRecommendations.getState().generatedAt < STALE_MS) return;
  if (inFlight) return inFlight;
  useRecommendations.setState({ loading: true });
  inFlight = (async () => {
    try {
      const lang = await lastAiLang();
      const r = await api.get<ServerRecs>(`/recommendations?lang=${lang}${force ? '&refresh=1' : ''}`);
      useRecommendations.setState({ sections: r.sections, ai: r.ai, generatedAt: Date.now() });
      await kvSet('recs', JSON.stringify(r)).catch(() => {});
    } catch (e) {
      if (!(e instanceof OfflineError)) console.warn('[recs] failed:', e);
    } finally {
      useRecommendations.setState({ loading: false });
      inFlight = null;
    }
  })();
  return inFlight;
}

export function clearRecommendations() {
  useRecommendations.setState({ sections: [], ai: false, loading: false, generatedAt: 0 });
}

/** Maps the server's shelves onto songs that are in this device's library. */
export async function resolveShelves(sections: ServerSection[]): Promise<Shelf[]> {
  const db = getDb();
  const out: Shelf[] = [];
  for (const s of sections) {
    if (!s.track_ids.length) continue;
    const rows = await db.getAllAsync<Track>(
      `SELECT * FROM tracks WHERE remote_id IN (${s.track_ids.map(Number).join(',')}) AND EXISTS (SELECT 1 FROM items i WHERE i.track_id = tracks.id)`,
    );
    const byRemote = new Map(rows.map((t) => [t.remote_id, t]));
    const tracks = s.track_ids.map((id) => byRemote.get(id)).filter((t): t is Track => !!t);
    if (tracks.length >= 3) out.push({ title: s.title, reason: s.reason, tracks });
  }
  return out;
}
