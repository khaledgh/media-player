import { useQuery } from '@tanstack/react-query';
import { ExternalLink, SquarePlay as YoutubeIcon } from 'lucide-react';
import { api, timeAgo } from '../api';
import type { YouTubeJob } from '../api';
import { Badge, Card, Empty, Spinner } from '../components/ui';
import { PageHeader } from '../components/Layout';

export function StatusBadge({ status }: { status: 'queued' | 'running' | 'done' | 'error' }) {
  const map = {
    queued: <Badge>Queued</Badge>,
    running: (
      <Badge tone="brand">
        <span className="size-1.5 animate-pulse rounded-full bg-brand" /> Working
      </Badge>
    ),
    done: <Badge tone="ok">Done</Badge>,
    error: <Badge tone="danger">Failed</Badge>,
  };
  return map[status];
}

export default function YouTube() {
  const q = useQuery({
    queryKey: ['youtube-jobs'],
    queryFn: () => api.get<YouTubeJob[]>('/admin/youtube-jobs'),
    refetchInterval: (query) => (query.state.data?.some((j) => j.status === 'queued' || j.status === 'running') ? 3000 : 15000),
  });

  return (
    <div className="pb-10">
      <PageHeader title="YouTube downloads" subtitle="Links users saved from the app. Each video is downloaded once and stored in the cloud." />
      <div className="px-4 sm:px-8">
        <Card>
          {q.isLoading ? (
            <div className="p-8">
              <Spinner />
            </div>
          ) : !q.data?.length ? (
            <Empty icon={<YoutubeIcon className="size-6" />} title="No downloads yet">
              When a user pastes a YouTube link in the app, it shows up here.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line/60">
                    <th className="px-5 py-3 font-medium">Video</th>
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.map((j) => (
                    <tr key={j.id} className="border-b border-line/40 last:border-0 align-top">
                      <td className="px-5 py-3">
                        <a href={j.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-brand">
                          {j.url.replace('https://www.youtube.com/watch?v=', 'youtu.be/')}
                          <ExternalLink className="size-3.5" />
                        </a>
                        {j.error && <p className="mt-1 max-w-xl text-xs break-words text-danger">{j.error}</p>}
                      </td>
                      <td className="px-5 py-3 text-muted">{j.user_email}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-muted">{timeAgo(j.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
