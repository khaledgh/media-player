import { api, ApiError } from './ApiClient';
import { getDb, kvGet, kvSet, libraryEvents } from '../data/db';
import type { Track } from '../data/library';

export type AiLang = 'ar' | 'en';

export interface NameSuggestion {
  trackId: number; // local id
  remoteId: number;
  oldTitle: string;
  oldArtist: string;
  title: string;
  artist: string;
  confidence: 'high' | 'low';
}

export const AI_LANG_LABELS: Record<AiLang, string> = { ar: 'Arabic (العربية)', en: 'English' };

/** The language picked last time, used as the preselected choice. */
export async function lastAiLang(): Promise<AiLang> {
  return (await kvGet('ai_lang').catch(() => null)) === 'en' ? 'en' : 'ar';
}

export function rememberAiLang(lang: AiLang) {
  kvSet('ai_lang', lang).catch(() => {});
}

const BATCH = 50;

/** Asks the server (Gemini) for cleaner names. Nothing is saved: the caller reviews the result first. */
export async function suggestNames(tracks: Track[], lang: AiLang): Promise<NameSuggestion[]> {
  const synced = tracks.filter((t) => t.remote_id);
  const byRemote = new Map(synced.map((t) => [t.remote_id!, t]));
  const out: NameSuggestion[] = [];
  for (let i = 0; i < synced.length; i += BATCH) {
    const ids = synced.slice(i, i + BATCH).map((t) => t.remote_id!);
    let rows: { id: number; old_title: string; old_artist: string; title: string; artist: string; confidence: 'high' | 'low' }[];
    try {
      rows = await api.post('/tracks/ai-suggest', { track_ids: ids, lang });
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) throw new Error('AI is not set up on the server yet (ask your admin to add the Gemini key).');
      throw e;
    }
    for (const r of rows) {
      const t = byRemote.get(r.id);
      if (!t) continue;
      out.push({ trackId: t.id, remoteId: r.id, oldTitle: r.old_title, oldArtist: r.old_artist, title: r.title, artist: r.artist, confidence: r.confidence });
    }
  }
  return out;
}

export const hasChange = (s: NameSuggestion) => s.title !== s.oldTitle || s.artist !== s.oldArtist;

/** Saves a new name on the server (it then syncs to every device) and in the local library. */
export async function applyName(s: Pick<NameSuggestion, 'trackId' | 'remoteId' | 'title' | 'artist'>) {
  try {
    await api.patch(`/tracks/${s.remoteId}`, { title: s.title, artist: s.artist });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) throw new Error('Songs in shared folders can only be renamed by your admin.');
    throw e;
  }
  await getDb().runAsync('UPDATE tracks SET title = ?, artist = ? WHERE id = ?', [s.title, s.artist, s.trackId]);
  libraryEvents.emit();
}
