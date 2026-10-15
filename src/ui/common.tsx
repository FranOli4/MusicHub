import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ---------- toasts ----------

let toastMsg: { id: number; text: string } | null = null;
const toastListeners = new Set<() => void>();

export function toast(text: string) {
  const id = Date.now();
  toastMsg = { id, text };
  toastListeners.forEach((fn) => fn());
  setTimeout(() => {
    if (toastMsg?.id === id) {
      toastMsg = null;
      toastListeners.forEach((fn) => fn());
    }
  }, 2600);
}

export function Toasts() {
  const msg = useSyncExternalStore(
    (fn) => (toastListeners.add(fn), () => toastListeners.delete(fn)),
    () => toastMsg,
  );
  return (
    <div className="toast-host" aria-live="polite">
      {msg && <div className="toast">{msg.text}</div>}
    </div>
  );
}

// ---------- modal sheet ----------

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function minutesLeft(epochMs: number, now: number): string {
  const m = Math.max(0, Math.ceil((epochMs - now) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Re-render every `ms` (for countdowns). */
export function useNow(ms = 15_000): number {
  return useSyncExternalStore(
    (fn) => {
      const t = setInterval(fn, ms);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / ms) * ms,
  );
}
