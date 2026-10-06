import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, FolderTree, HardDrive, Music, Smartphone, UserRound, SquarePlay as Youtube } from 'lucide-react';
import type { ReactNode } from 'react';
import { api, formatBytes, timeAgo } from '../api';
import type { ImportJob, Stats, YouTubeJob } from '../api';
import { Badge, Card, Spinner } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { StatusBadge } from './YouTube';

function Stat({ icon, label, value, to }: { icon: ReactNode; label: string; value: string | number; to?: string }) {
  const body = (
    <Card className="flex items-center gap-4 p-5 transition-colors hover:border-brand/40">
      <div className="flex size-11 items-center justify-center rounded-xl bg-brand/12 text-brand">{icon}</div>
      <div>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function Dashboard() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/admin/stats') });
  const imports = useQuery({ queryKey: ['imports'], queryFn: () => api.get<ImportJob[]>('/admin/imports') });
  const yt = useQuery({ queryKey: ['youtube-jobs'], queryFn: () => api.get<YouTubeJob[]>('/admin/youtube-jobs') });
  const s = stats.data;

  return (
    <div className="pb-10">
      <PageHeader title="Dashboard" subtitle="Your music service at a glance." />
      <div className="px-4 sm:px-8">
        {!s ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={<UserRound className="size-5" />} label="Users" value={s.users} to="/users" />
            <Stat icon={<Smartphone className="size-5" />} label="Active devices (30 days)" value={s.active_devices} />
            <Stat icon={<Music className="size-5" />} label="Tracks in the cloud" value={s.tracks} to="/library" />
            <Stat icon={<HardDrive className="size-5" />} label="Storage used" value={formatBytes(s.storage_bytes)} />
            <Stat icon={<FolderTree className="size-5" />} label="Shared folders" value={s.shared_folders} to="/library" />
            <Stat icon={<FolderTree className="size-5" />} label="User folders" value={s.user_folders} />
            <Stat icon={<Youtube className="size-5" />} label="YouTube downloads today" value={s.youtube_today} to="/youtube" />
            <Stat icon={<AlertTriangle className="size-5" />} label="Failed downloads (7 days)" value={s.youtube_failed} to="/youtube" />
          </div>
        )}

        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Recent uploads</h2>
            {imports.data?.length ? (
              <ul className="divide-y divide-line/60">
                {imports.data.slice(0, 6).map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{j.file_name}</p>
                      <p className="text-xs text-muted">
                        {j.processed}/{j.total} files · {timeAgo(j.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={j.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No uploads yet. Open the Library to add music.</p>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Recent YouTube downloads</h2>
            {yt.data?.length ? (
              <ul className="divide-y divide-line/60">
                {yt.data.slice(0, 6).map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{j.url}</p>
                      <p className="text-xs text-muted">
                        {j.user_email} · {timeAgo(j.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={j.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                No downloads yet. <Badge>Users add these from the app</Badge>
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
