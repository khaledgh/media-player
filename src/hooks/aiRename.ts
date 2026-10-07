import { AI_LANG_LABELS, applyName, hasChange, lastAiLang, rememberAiLang, suggestNames } from '../services/AiNames';
import type { AiLang } from '../services/AiNames';
import type { Track } from '../data/library';

interface Ui {
  toast: (msg: string) => void;
  confirm: (o: { title: string; message?: string; confirm?: string; danger?: boolean }) => Promise<boolean>;
  choose: <T extends string>(o: { title: string; options: { value: T; label: string }[]; selected?: T }) => Promise<T | null>;
}

export async function chooseAiLang(ui: Pick<Ui, 'choose'>, title = 'Write the name in'): Promise<AiLang | null> {
  const lang = await ui.choose<AiLang>({
    title,
    selected: await lastAiLang(),
    options: (Object.keys(AI_LANG_LABELS) as AiLang[]).map((value) => ({ value, label: AI_LANG_LABELS[value] })),
  });
  if (lang) rememberAiLang(lang);
  return lang;
}

const line = (title: string, artist: string) => (artist ? `${title} — ${artist}` : title);

/**
 * Lets the user pick Arabic or English, asks Gemini for cleaner names, shows
 * what would change, and only renames after the user agrees.
 */
export async function aiRenameSongs(tracks: Track[], ui: Ui) {
  const synced = tracks.filter((t) => t.remote_id);
  if (!synced.length) return ui.toast('These songs are still uploading — try again in a moment.');
  const lang = await chooseAiLang(ui);
  if (!lang) return;

  ui.toast('Asking AI…');
  const changes = (await suggestNames(synced, lang)).filter(hasChange);
  if (!changes.length) return ui.toast('The names already look good');

  const unsure = changes.filter((c) => c.confidence === 'low').length;
  const preview = changes
    .slice(0, 4)
    .map((c) => `${line(c.oldTitle, c.oldArtist)}\n→ ${line(c.title, c.artist)}`)
    .join('\n\n');
  const more = changes.length > 4 ? `\n\n…and ${changes.length - 4} more` : '';
  const warn = unsure ? `\n\n${unsure} suggestion${unsure === 1 ? ' is' : 's are'} a guess — check the result.` : '';
  const ok = await ui.confirm({
    title: changes.length === 1 ? 'Rename this song?' : `Rename ${changes.length} songs?`,
    message: preview + more + warn,
    confirm: 'Rename',
  });
  if (!ok) return;

  let failed = 0;
  let lastError = '';
  for (const c of changes) {
    try {
      await applyName(c);
    } catch (e) {
      failed++;
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (failed) ui.toast(failed === changes.length ? lastError : `Renamed ${changes.length - failed}, ${failed} could not be saved`);
  else ui.toast(changes.length === 1 ? 'Renamed' : `Renamed ${changes.length} songs`);
}
