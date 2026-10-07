import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  GripVertical,
  Library as LibraryIcon,
  ListPlus,
  Pause,
  Pencil,
  Play,
  Search,
  Sparkles,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
  SquarePlay as Youtube,
} from 'lucide-react';
import { api, formatBytes, formatDuration, uploadFiles } from '../api';
import type { AdminUser, Folder, Group, ImportJob, Track } from '../api';
import { Badge, Button, Card, Checkbox, Empty, IconButton, Input, Modal, Select, Spinner, cx, errMsg, useConfirm, useToast } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { AiRename } from '../components/AiRename';
import { StatusBadge } from './YouTube';

type Node = Folder & { children: Node[] };

function buildTree(folders: Folder[]): Node[] {
  const byId = new Map<number, Node>(folders.map((f) => [f.id, { ...f, children: [] }]));
  const roots: Node[] = [];
  byId.forEach((n) => {
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined;
    (parent ? parent.children : roots).push(n);
  });
  const sort = (list: Node[]) => {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

function pathTo(folders: Folder[], id: number): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  let cur = byId.get(id);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

function TreeItem({ node, depth, selected }: { node: Node; depth: number; selected?: number }) {
  const [open, setOpen] = useState(true);
  const active = node.id === selected;
  return (
    <li>
      <div
        className={cx(
          'group flex items-center gap-1 rounded-xl pr-2 text-sm transition-colors',
          active ? 'bg-brand/12 text-brand' : 'text-white/90 hover:bg-surface-2',
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        <button
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(!open)}
          className={cx('flex size-6 items-center justify-center rounded text-muted', !node.children.length && 'invisible')}
        >
          <ChevronRight className={cx('size-4 transition-transform', open && 'rotate-90')} />
        </button>
        <Link to={`/library/${node.id}`} className="flex min-w-0 flex-1 items-center gap-2 py-2">
          <FolderIcon className={cx('size-4 shrink-0', active ? 'fill-brand/30' : 'text-brand')} />
          <span className="truncate">{node.name}</span>
          <span className="ml-auto text-xs text-muted tabular-nums">{node.track_count || ''}</span>
        </Link>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} depth={depth + 1} selected={selected} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Library() {
  const { folderId } = useParams();
  const selected = folderId ? Number(folderId) : undefined;
  const qc = useQueryClient();
  const toast = useToast();
  const folders = useQuery({ queryKey: ['folders'], queryFn: () => api.get<Folder[]>('/admin/folders') });
  const tree = useMemo(() => buildTree(folders.data ?? []), [folders.data]);
  const current = folders.data?.find((f) => f.id === selected);
  const [naming, setNaming] = useState<{ parent: number | null } | null>(null);
  const [name, setName] = useState('');
  const navigate = useNavigate();

  async function createFolder() {
    if (!naming || !name.trim()) return;
    try {
      const { id } = await api.post<{ id: number }>('/admin/folders', { name, parent_id: naming.parent });
      await qc.invalidateQueries({ queryKey: ['folders'] });
      setNaming(null);
      setName('');
      navigate(`/library/${id}`);
    } catch (e) {
      toast(errMsg(e), 'danger');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Library"
        subtitle="Shared folders. Upload music here and choose who receives it in the app."
        actions={
          <Button icon={<FolderPlus className="size-4" />} onClick={() => setNaming({ parent: null })}>
            New folder
          </Button>
        }
      />
      <div className="grid min-h-0 flex-1 gap-6 px-4 pb-8 sm:px-8 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit max-h-full overflow-y-auto p-2 lg:sticky lg:top-0">
          {folders.isLoading ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : tree.length ? (
            <ul>
              {tree.map((n) => (
                <TreeItem key={n.id} node={n} depth={0} selected={selected} />
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted">No folders yet.</p>
          )}
        </Card>
        <div className="min-w-0">
          {current ? (
            <FolderPanel key={current.id} folder={current} all={folders.data ?? []} onNewSubfolder={() => setNaming({ parent: current.id })} />
          ) : (
            <Card>
              <Empty icon={<LibraryIcon className="size-6" />} title={tree.length ? 'Pick a folder' : 'Create your first folder'}>
                {tree.length
                  ? 'Select a folder on the left to upload music, reorder tracks and share it.'
                  : 'Folders hold music. Drop MP3s or a whole .zip into a folder and it appears in the app for the people you choose.'}
              </Empty>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={!!naming}
        title={naming?.parent ? 'New subfolder' : 'New folder'}
        onClose={() => setNaming(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNaming(null)}>
              Cancel
            </Button>
            <Button disabled={!name.trim()} onClick={createFolder}>
              Create
            </Button>
          </>
        }
      >
        <form
          className="pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            createFolder();
          }}
        >
          <Input label="Folder name" autoFocus placeholder="e.g. Top 100 Billboards" value={name} onChange={(e) => setName(e.target.value)} />
        </form>
      </Modal>
    </div>
  );
}

// ---------- folder panel ----------

function FolderPanel({ folder, all, onNewSubfolder }: { folder: Folder; all: Folder[]; onNewSubfolder: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'tracks' | 'access'>('tracks');
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [newName, setNewName] = useState(folder.name);
  const [target, setTarget] = useState('root');
  const crumbs = pathTo(all, folder.id);

  const refreshFolders = () => qc.invalidateQueries({ queryKey: ['folders'] });

  async function rename() {
    try {
      await api.patch(`/admin/folders/${folder.id}`, { name: newName });
      refreshFolders();
      setRenaming(false);
    } catch (e) {
      toast(errMsg(e), 'danger');
    }
  }

  async function move() {
    try {
      await api.patch(`/admin/folders/${folder.id}`, target === 'root' ? { to_root: true } : { parent_id: Number(target) });
      refreshFolders();
      setMoving(false);
      toast('Folder moved');
    } catch (e) {
      toast(errMsg(e), 'danger');
    }
  }

  async function remove() {
    if (!(await confirm(`Delete "${folder.name}" and everything inside it? It disappears from every user's app.`))) return;
    try {
      await api.del(`/admin/folders/${folder.id}`);
      await refreshFolders();
      navigate(folder.parent_id ? `/library/${folder.parent_id}` : '/library');
    } catch (e) {
      toast(errMsg(e), 'danger');
    }
  }

  // A folder cannot move into itself or its own subfolders.
  const descendants = useMemo(() => {
    const out = new Set([folder.id]);
    let grew = true;
    while (grew) {
      grew = false;
      all.forEach((f) => {
        if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
          out.add(f.id);
          grew = true;
        }
      });
    }
    return out;
  }, [all, folder.id]);

  return (
    <Card>
      <div className="border-b border-line/60 p-5">
        <nav className="flex flex-wrap items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
          <Link to="/library" className="hover:text-white">
            Library
          </Link>
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="size-3" />
              <Link to={`/library/${c.id}`} className="hover:text-white">
                {c.name}
              </Link>
            </span>
          ))}
        </nav>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-brand shadow-lg shadow-brand/30">
              <FolderIcon className="size-7 fill-white/90 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">{folder.name}</h2>
              <p className="text-sm text-muted">{folder.track_count} songs</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <IconButton label="New subfolder" onClick={onNewSubfolder}>
              <FolderPlus className="size-4" />
            </IconButton>
            <IconButton label="Rename" onClick={() => (setNewName(folder.name), setRenaming(true))}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Move" onClick={() => (setTarget(folder.parent_id ? String(folder.parent_id) : 'root'), setMoving(true))}>
              <FolderInput className="size-4" />
            </IconButton>
            <IconButton label="Delete folder" onClick={remove}>
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        </div>
        <div className="mt-5 flex gap-1" role="tablist">
          {(['tracks', 'access'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cx(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                tab === t ? 'bg-brand text-white' : 'text-muted hover:text-white',
              )}
            >
              {t === 'tracks' ? 'Songs' : 'Who can see it'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'tracks' ? <TracksTab folder={folder} /> : <AccessTab folder={folder} isSubfolder={!!folder.parent_id} />}

      <Modal
        open={renaming}
        title="Rename folder"
        onClose={() => setRenaming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button disabled={!newName.trim()} onClick={rename}>
              Save
            </Button>
          </>
        }
      >
        <form
          className="pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <Input label="Folder name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} />
        </form>
      </Modal>

      <Modal
        open={moving}
        title="Move folder"
        onClose={() => setMoving(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button onClick={move}>Move</Button>
          </>
        }
      >
        <div className="pb-2">
          <Select label="Move into" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="root">Top level</option>
            {all
              .filter((f) => !descendants.has(f.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {pathTo(all, f.id)
                    .map((p) => p.name)
                    .join(' / ')}
                </option>
              ))}
          </Select>
        </div>
      </Modal>
    </Card>
  );
}

// ---------- songs ----------

function TracksTab({ folder }: { folder: Folder }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const tracks = useQuery({ queryKey: ['folder-tracks', folder.id], queryFn: () => api.get<Track[]>(`/admin/folders/${folder.id}/tracks`) });
  const [order, setOrder] = useState<Track[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const player = usePreview();

  useEffect(() => setOrder(tracks.data ?? []), [tracks.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['folder-tracks', folder.id] });
    qc.invalidateQueries({ queryKey: ['folders'] });
  };

  function onDragOver(e: DragEvent, overIdx: number) {
    e.preventDefault();
    if (dragging === null || dragging === overIdx) return;
    const next = [...order];
    const [moved] = next.splice(dragging, 1);
    next.splice(overIdx, 0, moved);
    setOrder(next);
    setDragging(overIdx);
  }

  async function saveOrder() {
    setDragging(null);
    try {
      await api.put(`/admin/folders/${folder.id}/tracks/order`, { item_ids: order.map((t) => t.item_id) });
    } catch (e) {
      toast(errMsg(e), 'danger');
      refresh();
    }
  }

  async function remove(t: Track) {
    if (!(await confirm(`Remove "${t.title}" from this folder?`, 'Remove'))) return;
    try {
      await api.del(`/admin/folders/${folder.id}/tracks/${t.item_id}`);
      refresh();
    } catch (e) {
      toast(errMsg(e), 'danger');
    }
  }

  return (
    <div className="p-5">
      <Uploader folderId={folder.id} onImported={refresh} />
      <div className="mt-6 mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Songs</h3>
        <div className="flex items-center gap-1">
          {order.length > 0 && (
            <Button variant="ghost" icon={<Sparkles className="size-4" />} onClick={() => setAiOpen(true)}>
              Fix names with AI{picked.length ? ` (${picked.length})` : ''}
            </Button>
          )}
          <Button variant="ghost" icon={<ListPlus className="size-4" />} onClick={() => setAdding(true)}>
            Add from library
          </Button>
        </div>
      </div>
      {tracks.isLoading ? (
        <Spinner />
      ) : !order.length ? (
        <p className="py-6 text-center text-sm text-muted">This folder is empty. Upload music above.</p>
      ) : (
        <ul className="divide-y divide-line/40">
          {order.map((t, i) => (
            <li
              key={t.item_id}
              draggable
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDragEnd={saveOrder}
              className={cx('group flex items-center gap-3 py-2.5', dragging === i && 'opacity-40')}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted/60" aria-hidden />
              <input
                type="checkbox"
                aria-label={`Select ${t.title}`}
                className="size-4 shrink-0 accent-[#ff8216]"
                checked={picked.includes(t.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))}
              />
              <Cover track={t} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.title}</p>
                <p className="truncate text-xs text-muted">
                  {[t.artist || 'Unknown artist', formatDuration(t.duration_ms), formatBytes(t.size_bytes)].join(' · ')}
                </p>
              </div>
              {t.source === 'youtube' && (
                <Badge>
                  <Youtube className="size-3" /> YouTube
                </Badge>
              )}
              <button
                aria-label={player.playing === t.id ? 'Pause preview' : 'Play preview'}
                onClick={() => player.toggle(t.id)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-hover"
              >
                {player.playing === t.id ? <Pause className="size-3.5 fill-white" /> : <Play className="ml-0.5 size-3.5 fill-white" />}
              </button>
              <IconButton label="Edit details" onClick={() => setEditing(t)}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton label="Remove from folder" onClick={() => remove(t)}>
                <X className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <EditTrack
        track={editing}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        onAi={(id) => {
          setPicked([id]);
          setAiOpen(true);
        }}
      />
      <AiRename
        open={aiOpen}
        trackIds={picked.length ? picked : order.map((t) => t.id).slice(0, 100)}
        onClose={() => setAiOpen(false)}
        onDone={() => {
          setPicked([]);
          refresh();
        }}
      />
      <AddExisting open={adding} folderId={folder.id} existing={order.map((t) => t.id)} onClose={() => setAdding(false)} onAdded={refresh} />
    </div>
  );
}

function Cover({ track }: { track: Track }) {
  const hue = (track.id * 47) % 360;
  return (
    <div
      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white/90"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 40) % 360} 70% 30%))` }}
    >
      {track.title[0]?.toUpperCase()}
    </div>
  );
}

function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  return {
    playing,
    async toggle(id: number) {
      if (playing === id) {
        audio.current?.pause();
        setPlaying(null);
        return;
      }
      audio.current?.pause();
      const { url } = await api.get<{ url: string }>(`/admin/tracks/${id}/url`);
      const a = new Audio(url);
      a.onended = () => setPlaying(null);
      audio.current = a;
      await a.play();
      setPlaying(id);
    },
  };
}

function Uploader({ folderId, onImported }: { folderId: number; onImported: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [jobIds, setJobIds] = useState<number[]>([]);

  const jobs = useQuery({
    queryKey: ['imports'],
    queryFn: () => api.get<ImportJob[]>('/admin/imports'),
    refetchInterval: (q) => (q.state.data?.some((j) => jobIds.includes(j.id) && (j.status === 'queued' || j.status === 'running')) ? 1000 : false),
    enabled: jobIds.length > 0,
  });
  const mine = (jobs.data ?? []).filter((j) => jobIds.includes(j.id));
  const finished = mine.filter((j) => j.status === 'done' || j.status === 'error').length;
  const lastFinished = useRef(0);

  useEffect(() => {
    if (finished > lastFinished.current) onImported();
    lastFinished.current = finished;
  }, [finished, onImported]);

  async function send(files: File[]) {
    if (!files.length) return;
    setProgress(0);
    try {
      const res = await uploadFiles(`/admin/folders/${folderId}/upload`, files, setProgress);
      setJobIds((ids) => [...res.job_ids, ...ids]);
      if (res.skipped.length) toast(`Skipped unsupported files: ${res.skipped.join(', ')}`, 'danger');
    } catch (e) {
      toast(errMsg(e), 'danger');
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          send([...e.dataTransfer.files]);
        }}
        className={cx(
          'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          over ? 'border-brand bg-brand/8' : 'border-line',
        )}
      >
        <UploadCloud className="size-8 text-brand" />
        <p className="text-sm font-medium">Drop MP3s or a .zip here</p>
        <p className="text-xs text-muted">Zips are unpacked automatically; folders inside become subfolders.</p>
        <Button variant="secondary" className="mt-2" disabled={progress !== null} onClick={() => input.current?.click()}>
          Browse files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".mp3,.m4a,.aac,.flac,.ogg,.opus,.wav,.zip"
          onChange={(e) => {
            send([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        {progress !== null && (
          <div className="mt-3 w-full max-w-sm">
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-brand transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">Uploading… {Math.round(progress * 100)}%</p>
          </div>
        )}
      </div>
      {mine.length > 0 && (
        <ul className="mt-3 space-y-2">
          {mine.map((j) => (
            <li key={j.id} className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate">{j.file_name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {j.total > 0 && `${j.processed}/${j.total}`}
                  {j.failed > 0 && <span className="text-danger">{j.failed} failed</span>}
                  <StatusBadge status={j.status} />
                </span>
              </div>
              {j.total > 1 && j.status !== 'done' && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-brand transition-all" style={{ width: `${(j.processed / j.total) * 100}%` }} />
                </div>
              )}
              {j.error && <p className="mt-2 text-xs whitespace-pre-line text-danger">{j.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditTrack({ track, onClose, onSaved, onAi }: { track: Track | null; onClose: () => void; onSaved: () => void; onAi: (id: number) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', artist: '', album: '' });
  useEffect(() => {
    if (track) setForm({ title: track.title, artist: track.artist, album: track.album });
  }, [track]);
  async function save() {
    try {
      await api.patch(`/admin/tracks/${track!.id}`, form);
      onSaved();
      onClose();
    } catch (e) {
      toast(errMsg(e), 'danger');
    }
  }
  return (
    <Modal
      open={!!track}
      title="Song details"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.title.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input label="Artist" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} />
        <Input label="Album" value={form.album} onChange={(e) => setForm({ ...form, album: e.target.value })} />
        <Button
          variant="secondary"
          icon={<Sparkles className="size-4" />}
          onClick={() => {
            onClose();
            onAi(track!.id);
          }}
        >
          Suggest with AI
        </Button>
        <p className="text-xs text-muted">Changes reach every app on its next sync.</p>
      </div>
    </Modal>
  );
}

function AddExisting({
  open,
  folderId,
  existing,
  onClose,
  onAdded,
}: {
  open: boolean;
  folderId: number;
  existing: number[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const results = useQuery({ queryKey: ['tracks', q], queryFn: () => api.get<Track[]>(`/admin/tracks?q=${encodeURIComponent(q)}`), enabled: open });
  async function add() {
    try {
      await api.post(`/admin/folders/${folderId}/tracks`, { track_ids: picked });
      setPicked([]);
      onAdded();
      onClose();
    } catch (e) {
      toast(errMsg(e), 'danger');
    }
  }
  return (
    <Modal
      open={open}
      wide
      title="Add songs from the library"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!picked.length} onClick={add}>
            Add {picked.length || ''} songs
          </Button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" />
        <Input autoFocus placeholder="Search by title, artist or album" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="pb-2">
        {results.data
          ?.filter((t) => !existing.includes(t.id))
          .map((t) => (
            <Checkbox key={t.id} checked={picked.includes(t.id)} onChange={(v) => setPicked(v ? [...picked, t.id] : picked.filter((x) => x !== t.id))}>
              {t.title} <span className="text-muted">· {t.artist || 'Unknown artist'}</span>
            </Checkbox>
          ))}
      </div>
    </Modal>
  );
}

// ---------- access ----------

function AccessTab({ folder, isSubfolder }: { folder: Folder; isSubfolder: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<AdminUser[]>('/admin/users') });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/admin/groups') });
  const access = useQuery({
    queryKey: ['access', folder.id],
    queryFn: () => api.get<{ user_ids: number[]; group_ids: number[] }>(`/admin/folders/${folder.id}/access`),
  });
  const [sel, setSel] = useState<{ user_ids: number[]; group_ids: number[] } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (access.data) setSel(access.data);
  }, [access.data]);

  if (!sel) return <div className="p-5"><Spinner /></div>;

  const toggle = (key: 'user_ids' | 'group_ids', id: number, on: boolean) =>
    setSel({ ...sel, [key]: on ? [...sel[key], id] : sel[key].filter((x) => x !== id) });

  async function save() {
    setSaving(true);
    try {
      await api.put(`/admin/folders/${folder.id}/access`, sel);
      qc.invalidateQueries({ queryKey: ['access', folder.id] });
      toast('Sharing updated. Apps pick it up on their next sync.');
    } catch (e) {
      toast(errMsg(e), 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-5">
      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
        People you pick here get this folder and all its subfolders in their app, and the songs download to their phones automatically.
        {isSubfolder && ' People with access to a parent folder already see this one.'}
      </p>
      <Section title="Groups">
        {groups.data?.length ? (
          groups.data.map((g) => (
            <Checkbox key={g.id} checked={sel.group_ids.includes(g.id)} onChange={(v) => toggle('group_ids', g.id, v)}>
              {g.name} <span className="text-muted">· {g.user_ids.length} members</span>
            </Checkbox>
          ))
        ) : (
          <p className="px-3 py-2 text-sm text-muted">
            No groups yet — <Link to="/groups" className="text-brand">create one</Link>.
          </p>
        )}
      </Section>
      <Section title="People">
        {users.data
          ?.filter((u) => u.role === 'user' || u.role === 'admin')
          .map((u) => (
            <Checkbox key={u.id} checked={sel.user_ids.includes(u.id)} onChange={(v) => toggle('user_ids', u.id, v)}>
              {u.name || u.email} <span className="text-muted">· {u.email}</span>
            </Checkbox>
          ))}
      </Section>
      <div className="flex justify-end">
        <Button loading={saving} onClick={save}>
          Save sharing
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{title}</p>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-line">{children}</div>
    </div>
  );
}
