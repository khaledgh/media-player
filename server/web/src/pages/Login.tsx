import { useState } from 'react';
import type { FormEvent } from 'react';
import { auth } from '../api';
import { Button, Input, errMsg } from '../components/ui';
import { Logo } from '../components/Layout';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await auth.login(email, password);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute -top-40 -right-40 size-[480px] rounded-full bg-brand/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -left-32 size-[420px] rounded-full bg-brand/10 blur-3xl" />
      <form onSubmit={submit} className="relative w-full max-w-sm space-y-6 rounded-3xl border border-line/60 bg-surface/90 p-8 backdrop-blur">
        <Logo />
        <div>
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Sign in to manage users and music.</p>
        </div>
        <div className="space-y-4">
          <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy} className="w-full h-12">
          Sign in
        </Button>
      </form>
    </div>
  );
}
