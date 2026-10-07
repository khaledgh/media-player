import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CloudDownload, Disc3, Headphones, Heart, HardDrive, Music, Smartphone, UserRound, SquarePlay as Youtube } from 'lucide-react';
import { api, formatBytes, timeAgo } from '../api';
import type { ImportJob, Overview, Stats, YouTubeJob } from '../api';
import { Badge, Card, Spinner } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { AreaChart, KPI, RangePicker, RankList } from '../components/charts';
import { StatusBadge } from './YouTube';

const n = (v: number) => v.toLocaleString();

function Panel({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`p-5 sm:p-6 ${className ?? ''}`}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/admin/stats') });
  const ov = useQuery({ queryKey: ['overview', days], queryFn: () => api.get<Overview>(`/admin/stats/overview?days=${days}`), placeholderData: (p) => p });
  const imports = useQuery({ queryKey: ['imports'], queryFn: () => api.get<ImportJob[]>('/admin/imports') });
  const yt = useQuery({ queryKey: ['youtube-jobs'], queryFn: () => api.get<YouTubeJob[]>('/admin/youtube-jobs') });
  const s = stats.data;
  const o = ov.data;

  return (
    <div className="pb-12">
      <PageHeader title="Dashboard" subtitle="What people listen to and download, and how the service is doing." actions={<RangePicker value={days} onChange={setDays} />} />
      <div className="space-y-6 px-4 sm:px-8">
        {!s || !o ? (
          <Spinner />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KPI icon={<Headphones className="size-[18px]" />} label={`Plays · ${days} days`} value={n(o.plays_period)} hint={`${n(o.plays_total)} all time`} />
              <KPI icon={<UserRound className="size-[18px]" />} label="Active listeners" value={n(o.listeners_period)} hint={`of ${n(s.users)} users`} tone="info" />
              <KPI icon={<CloudDownload className="size-[18px]" />} label="Downloads to devices" value={n(o.downloads_total)} hint="songs saved offline" tone="ok" />
              <KPI icon={<Heart className="size-[18px]" />} label="Favorites" value={n(o.favorites_total)} hint="songs hearted by users" tone="danger" />
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <Panel className="xl:col-span-2" title="Listening activity" subtitle={`Plays per day, last ${days} days`}>
                <AreaChart data={o.daily} />
              </Panel>
              <Panel title="Top listeners" subtitle="Most plays, all time">
                <RankList
                  items={o.top_users.filter((u) => u.plays > 0)}
                  label={(u) => (
                    <Link to={`/users/${u.id}`} className="hover:text-brand">
                      {u.name || u.email}
                    </Link>
                  )}
                  sub={(u) => `${u.downloads} downloads · ${u.last_played_at ? `last played ${timeAgo(u.last_played_at)}` : 'never played'}`}
                  value={(u) => u.plays}
                  unit="plays"
                  empty="No listening reported yet."
                />
              </Panel>
            </div>

            <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
              <Panel title="Most played songs" subtitle="Across all users">
                <RankList
                  items={o.top_tracks}
                  label={(t) => t.title}
                  sub={(t) => `${t.artist || 'Unknown artist'} · ${t.listeners} listener${t.listeners === 1 ? '' : 's'}`}
                  value={(t) => t.plays}
                  unit="plays"
                  empty="No plays reported yet."
                />
              </Panel>
              <Panel title="Most downloaded songs" subtitle="Saved for offline listening">
                <RankList
                  items={o.top_downloaded}
                  label={(t) => t.title}
                  sub={(t) => t.artist || 'Unknown artist'}
                  value={(t) => t.downloads}
                  unit="downloads"
                  empty="No downloads yet."
                />
              </Panel>
              <Panel title="Top artists" subtitle="By plays">
                <RankList items={o.top_artists} label={(a) => a.artist} sub={(a) => `${a.tracks} song${a.tracks === 1 ? '' : 's'} played`} value={(a) => a.plays} unit="plays" empty="No plays reported yet." />
              </Panel>
            </div>

            <div>
              <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Library & service</h2>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <MiniStat icon={<Music className="size-4" />} label="Tracks" value={n(s.tracks)} to="/library" />
                <MiniStat icon={<HardDrive className="size-4" />} label="Storage" value={formatBytes(s.storage_bytes)} />
                <MiniStat icon={<Smartphone className="size-4" />} label="Active devices" value={n(s.active_devices)} />
                <MiniStat icon={<Disc3 className="size-4" />} label="Folders" value={`${n(s.shared_folders)} shared · ${n(s.user_folders)} personal`} to="/library" />
                <MiniStat icon={<Youtube className="size-4" />} label="YouTube today" value={n(s.youtube_today)} to="/youtube" />
                <MiniStat icon={<Youtube className="size-4" />} label="Failed (7 days)" value={n(s.youtube_failed)} to="/youtube" danger={s.youtube_failed > 0} />
              </div>
            </div>
          </>
        )}

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Recent uploads">
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
          </Panel>
          <Panel title="Recent YouTube downloads">
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
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, to, danger }: { icon: React.ReactNode; label: string; value: string; to?: string; danger?: boolean }) {
  const body = (
    <div className="flex items-center gap-3 rounded-xl border border-line/60 bg-surface px-4 py-3 transition-colors hover:border-brand/40">
      <span className={danger ? 'text-danger' : 'text-muted'}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
