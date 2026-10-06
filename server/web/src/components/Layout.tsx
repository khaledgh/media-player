import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { FolderTree, LayoutDashboard, LogOut, Menu, Music2, UsersRound, UserRound, SquarePlay as Youtube } from 'lucide-react';
import { auth } from '../api';
import { cx, IconButton } from './ui';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/library', label: 'Library', icon: FolderTree },
  { to: '/users', label: 'Users', icon: UserRound },
  { to: '/groups', label: 'Groups', icon: UsersRound },
  { to: '/youtube', label: 'YouTube', icon: Youtube },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-9 items-center justify-center rounded-full bg-brand">
        <Music2 className="size-5 text-white" />
      </div>
      <span className="text-xl font-semibold tracking-tight">Mume</span>
    </div>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const user = auth.user();
  return (
    <div className="flex h-full">
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line/60 bg-surface px-4 py-6 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="px-2">
          <Logo />
          <p className="mt-1 text-xs text-muted">Admin console</p>
        </div>
        <nav className="mt-8 flex-1 space-y-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand/12 text-brand' : 'text-muted hover:bg-surface-2 hover:text-white',
                )
              }
            >
              <Icon className="size-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/20 text-sm font-semibold text-brand">
            {(user?.name || user?.email || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name || 'Admin'}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>
          <IconButton label="Sign out" onClick={() => auth.logout()}>
            <LogOut className="size-4" />
          </IconButton>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line/60 px-4 py-3 lg:hidden">
          <IconButton label="Open menu" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
          </IconButton>
          <Logo />
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-6 pb-5 sm:px-8 sm:pt-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
