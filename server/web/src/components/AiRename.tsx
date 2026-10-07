import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../api';
import type { AiSuggestion } from '../api';
import { Badge, Button, Input, Modal, Select, Spinner, cx, errMsg, useToast } from './ui';

type Row = AiSuggestion & { apply: boolean };

/**
 * Asks Gemini for cleaner names, lets the admin review and edit every
 * suggestion, and only then saves the accepted ones (PATCH /admin/tracks/:id).
 */
export function AiRename({
  trackIds,
  open,
  onClose,
  onDone,
}: {
  trackIds: number[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setRows(null);
  }, [open]);

  async function suggest() {
    setBusy(true);
    try {
      const res = await api.post<AiSuggestion[]>('/admin/tracks/ai-suggest', { track_ids: trackIds, lang });
      setRows(res.map((r) => ({ ...r, apply: r.title !== r.old_title || r.artist !== r.old_artist })));
    } catch (e) {
      toast(errMsg(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  function patch(id: number, p: Partial<Row>) {
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, ...p } : r)) ?? null);
  }

  const chosen = rows?.filter((r) => r.apply && r.title.trim()) ?? [];

  async function apply() {
    setBusy(true);
    let failed = 0;
    for (const r of chosen) {
      try {
        await api.patch(`/admin/tracks/${r.id}`, { title: r.title, artist: r.artist });
      } catch {
        failed++;
      }
    }
    setBusy(false);
    if (failed) toast(`${failed} song(s) could not be saved`, 'danger');
    else toast(`Renamed ${chosen.length} song(s)`);
    onDone();
    onClose();
  }

  return (
    <Modal
      open={open}
      wide
      title="Fix names with AI"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {rows && (
            <Button disabled={busy || !chosen.length} onClick={apply}>
              Apply {chosen.length} change{chosen.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="flex items-end gap-3">
          <div className="w-48">
            <Select label="Write names in" value={lang} onChange={(e) => setLang(e.target.value as 'ar' | 'en')}>
              <option value="ar">Arabic (العربية)</option>
              <option value="en">English</option>
            </Select>
          </div>
          <Button icon={<Sparkles className="size-4" />} disabled={busy || !trackIds.length} onClick={suggest}>
            {rows ? 'Suggest again' : `Suggest for ${trackIds.length} song${trackIds.length === 1 ? '' : 's'}`}
          </Button>
          {busy && <Spinner />}
        </div>
        {rows && (
          <ul className="divide-y divide-line/40">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-2 size-4 accent-[#ff8216]" checked={r.apply} onChange={(e) => patch(r.id, { apply: e.target.checked })} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="truncate text-xs text-muted">
                      Was: {r.old_title}
                      {r.old_artist ? ` — ${r.old_artist}` : ''}
                    </p>
                    <div className={cx('grid gap-2 sm:grid-cols-2', !r.apply && 'opacity-50')}>
                      <Input dir="auto" aria-label="New title" value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} />
                      <Input dir="auto" aria-label="New artist" value={r.artist} onChange={(e) => patch(r.id, { artist: e.target.value })} />
                    </div>
                  </div>
                  {r.confidence === 'low' && <Badge tone="danger">Not sure</Badge>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {!rows && <p className="text-xs text-muted">Nothing changes until you review the suggestions and press Apply.</p>}
      </div>
    </Modal>
  );
}
