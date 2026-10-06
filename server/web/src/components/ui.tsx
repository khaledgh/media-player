import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Loader2, X } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover shadow-[0_6px_20px_-6px] shadow-brand/60',
  secondary: 'bg-surface-2 text-white hover:bg-line',
  ghost: 'text-muted hover:text-white hover:bg-surface-2',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
};

export function Button({
  variant = 'primary',
  loading,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full px-4 h-10 text-sm font-medium transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-brand',
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 items-center justify-center rounded-full text-muted hover:text-white hover:bg-surface-2 transition-colors',
        'disabled:opacity-40 disabled:pointer-events-none',
        className,
      )}
    />
  );
}

export function Input({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const input = (
    <input
      {...rest}
      className={cx(
        'h-11 w-full rounded-xl bg-surface-2 border border-line px-4 text-sm text-white placeholder:text-muted/70',
        'focus:outline-none focus:border-brand transition-colors',
        className,
      )}
    />
  );
  if (!label) return input;
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {input}
    </label>
  );
}

export function Select({ label, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-xs font-medium text-muted">{label}</span>}
      <select
        {...rest}
        className="h-11 w-full rounded-xl bg-surface-2 border border-line px-3 text-sm text-white focus:outline-none focus:border-brand"
      >
        {children}
      </select>
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl bg-surface border border-line/60', className)}>{children}</div>;
}

export function Badge({ tone = 'muted', children }: { tone?: 'muted' | 'brand' | 'ok' | 'danger'; children: ReactNode }) {
  const tones = {
    muted: 'bg-surface-2 text-muted',
    brand: 'bg-brand/15 text-brand',
    ok: 'bg-ok/15 text-ok',
    danger: 'bg-danger/15 text-danger',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-brand', className)} />;
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('relative w-full rounded-2xl bg-surface border border-line shadow-2xl', wide ? 'max-w-2xl' : 'max-w-md')}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-6 pb-2">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line')}
    >
      <span className={cx('absolute top-0.5 size-5 rounded-full bg-white transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
      <input type="checkbox" className="size-4 accent-[#ff8216]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">{children}</span>
    </label>
  );
}

// ---------- toasts & confirm ----------

type Toast = { id: number; text: string; tone: 'ok' | 'danger' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
const ConfirmCtx = createContext<(text: string, action?: string) => Promise<boolean>>(async () => false);

export const useToast = () => useContext(ToastCtx);
export const useConfirm = () => useContext(ConfirmCtx);

export function Feedback({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<{ text: string; action: string } | null>(null);
  const resolver = useRef<(v: boolean) => void>(undefined);
  const nextId = useRef(0);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++nextId.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const confirm = useCallback(
    (text: string, action = 'Delete') =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setAsk({ text, action });
      }),
    [],
  );

  const close = (v: boolean) => {
    resolver.current?.(v);
    setAsk(null);
  };

  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <Modal
          open={!!ask}
          title="Are you sure?"
          onClose={() => close(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => close(true)}>
                {ask?.action}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">{ask?.text}</p>
        </Modal>
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                'rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur',
                t.tone === 'ok' ? 'border-ok/30 bg-surface/95' : 'border-danger/40 bg-surface/95 text-danger',
              )}
            >
              {t.text}
            </div>
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
