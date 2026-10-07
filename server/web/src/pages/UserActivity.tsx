import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CloudDownload, Headphones, Heart, Music } from 'lucide-react';
import { api, timeAgo } from '../api';
import type { AdminUser, UserActivity as Activity } from '../api';
import { Badge, Card, Spinner } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { AreaChart, KPI, RangePicker, RankList } from '../components/charts';

const n = (v: number) => v.toLocaleString();

export default function UserActivity() {
  const { userId } = useParams();
  const [days, setDays] = useState(30);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<AdminUser[]>('/admin/users') });
  const act = useQuery({
    queryKey: ['activity', userId, days],
    queryFn: () => api.get<Activity>(`/admin/users/${userId}/activity?days=${days}`),
    placeholderData: (p) => p,
  });
  const user = users.data?.find((u) => String(u.id) === userId);
  const a = act.data;

  return (
    <div className="pb-12">
      <PageHeader
        title={user ? user.name || user.email : 'User activity'}
        subtitle={user ? `${user.email} · ${a?.last_played_at ? `last played ${timeAgo(a.last_played_at)}` : 'has not played anything yet'}` : undefined}
        actions={
          <>
            <Link to="/users" className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2 text-sm text-muted hover:text-white">
              <ArrowLeft className="size-4" /> Users
            </Link>
            <RangePicker value={days} onChange={setDays} />
          </>
        }
      />
      <div className="space-y-6 px-4 sm:px-8">
        {!a ? (
          <Spinner />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <KPI icon={<Headphones className="size-[18px]" />} label={`Plays · ${days} days`} value={n(a.plays_period)} hint={`${n(a.plays_total)} all time`} />
              <KPI icon={<Music className="size-[18px]" />} label="Different songs" value={n(a.unique_tracks)} hint="played at least once" tone="info" />
              <KPI icon={<CloudDownload className="size-[18px]" />} label="Downloads" value={n(a.downloads_total)} hint="saved to their phones" tone="ok" />
              <KPI icon={<Heart className="size-[18px]" />} label="Favorites" value={n(a.favorites_total)} tone="danger" />
            </div>

            <Card className="p-5 sm:p-6">
              <h2 className="mb-1 font-semibold">Listening activity</h2>
              <p className="mb-5 text-xs text-muted">Plays per day, last {days} days</p>
              <AreaChart data={a.daily} />
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-5 sm:p-6">
                <h2 className="mb-5 font-semibold">Most played</h2>
                <RankList
                  items={a.top_played}
                  label={(t) => t.title}
                  sub={(t) => `${t.artist || 'Unknown artist'}${t.last_played_at ? ` · last ${timeAgo(t.last_played_at)}` : ''}`}
                  value={(t) => t.plays}
                  unit="plays"
                  empty="Nothing played yet."
                />
              </Card>
              <Card className="p-5 sm:p-6">
                <h2 className="mb-5 font-semibold">Downloaded</h2>
                <RankList
                  items={a.top_downloaded}
                  label={(t) => t.title}
                  sub={(t) => t.artist || 'Unknown artist'}
                  value={(t) => t.downloads}
                  unit={'×'}
                  empty="Nothing downloaded yet."
                />
              </Card>
            </div>

            {a.top_artists.length > 0 && (
              <Card className="p-5 sm:p-6">
                <h2 className="mb-4 font-semibold">Favorite artists</h2>
                <div className="flex flex-wrap gap-2">
                  {a.top_artists.map((x) => (
                    <Badge key={x.artist} tone="brand">
                      <span dir="auto">{x.artist}</span> · {x.plays}
                    </Badge>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
