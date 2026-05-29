'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ArchiveStatus {
  provider:    string;
  label:       string;
  isConnected: boolean;
  folderPath:  string;
  lastSyncAt:  string | null;
  lastError:   string | null;
}

// ── Provider icons (inline SVG) ───────────────────────────────────────────────

function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 87.3 78" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0a15.92 15.92 0 001.88 7.91z" fill="#0066da"/>
      <path d="M43.65 25L29.9 1.2a15.62 15.62 0 00-3.3 3.3L1.88 50.0H27.5z" fill="#00ac47"/>
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25A15.92 15.92 0 0087.3 50h-27.5L73.55 76.8z" fill="#ea4335"/>
      <path d="M43.65 25L57.4 1.2C56.05.43 54.5 0 52.9 0H34.4c-1.6 0-3.15.43-4.5 1.2z" fill="#00832d"/>
      <path d="M59.8 50H27.5L13.75 73.8c1.35.78 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.43 4.5-1.2z" fill="#2684fc"/>
      <path d="M73.4 26.5l-13.6-23.55c-1.35-.77-2.9-1.2-4.5-1.2H34.4L59.8 50h27.5z" fill="#ffba00"/>
    </svg>
  );
}

function DropboxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 528 444" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M132 0L0 88l132 88 132-88L132 0zm264 0L264 88l132 88 132-88L396 0zM0 264l132 88 132-88-132-88L0 264zm396-88l-132 88 132 88 132-88-132-88zM132 374l132 70 132-70-132-88-132 88z" fill="#0061FF"/>
    </svg>
  );
}

function OneDriveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M29.3 21.7c.6-.1 1.2-.2 1.8-.2 5.5 0 9.9 4.4 9.9 9.9 0 .3 0 .6-.1.9H41c3.3 0 6 2.7 6 6s-2.7 6-6 6H14.3c-4.4 0-7.9-3.5-7.9-7.9 0-3.5 2.3-6.5 5.5-7.5-.1-.5-.1-1-.1-1.5 0-4.7 3.8-8.5 8.5-8.5 1.2 0 2.4.3 3.4.7 1.5-3.5 4.9-5.9 8.9-5.9 3.1 0 5.9 1.5 7.7 3.9-1.2.7-2.2 1.7-3 2.9-.7-1-1.9-1.7-3.3-1.7-1.9 0-3.5 1.4-3.7 3.3z" fill="#0078D4"/>
      <path d="M20.3 24.5c.7-4 4.1-7 8.3-7 .5 0 1 .1 1.5.2 1.2-2.4 3.7-4 6.5-4 4.1 0 7.4 3.3 7.4 7.4 0 .2 0 .4-.1.6 2.7.6 4.7 3 4.7 5.8 0 3.3-2.7 6-6 6H13.4c-3.4 0-6.1-2.7-6.1-6.1 0-3.2 2.4-5.8 5.5-6-.1-.4-.1-.8-.1-1.2 0-3.9 3.2-7.1 7.1-7.1 1.2 0 2.4.3 3.4.8" fill="#1490DF"/>
    </svg>
  );
}

const PROVIDER_ICONS: Record<string, (p: { className?: string }) => JSX.Element> = {
  GOOGLE_DRIVE: GoogleDriveIcon,
  DROPBOX:      DropboxIcon,
  ONEDRIVE:     OneDriveIcon,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg',
        type === 'success'
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      <span>{type === 'success' ? '✓' : '✕'}</span>
      {message}
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────

function ProviderCard({
  status,
  onDisconnect,
}: {
  status:       ArchiveStatus;
  onDisconnect: (provider: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const Icon = PROVIDER_ICONS[status.provider];
  const lastSyncFormatted = fmtDate(status.lastSyncAt);

  async function handleDisconnect() {
    if (!confirm(`Disconnect ${status.label}? Archived files will not be deleted.`)) return;
    setBusy(true);
    try {
      await onDisconnect(status.provider);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        {/* Icon + name */}
        <div className="flex items-center gap-3">
          {Icon && <Icon className="h-9 w-9 shrink-0" />}
          <div>
            <p className="font-semibold">{status.label}</p>
            {status.isConnected && (
              <p className="mt-0.5 text-xs text-muted-foreground font-mono">{status.folderPath}</p>
            )}
          </div>
        </div>

        {/* Badge */}
        {status.isConnected ? (
          <span className="shrink-0 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
            Connected
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Not connected
          </span>
        )}
      </div>

      {/* Last sync */}
      {status.isConnected && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Last sync:</span>
          <span className={lastSyncFormatted ? 'text-foreground' : ''}>
            {lastSyncFormatted ?? 'Never — will sync on next invoice send'}
          </span>
        </div>
      )}

      {/* Error */}
      {status.lastError && (
        <p className="mt-2 text-xs text-destructive">{status.lastError}</p>
      )}

      {/* Action */}
      <div className="mt-4">
        {status.isConnected ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={busy}
            className={cn(
              'inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium',
              'text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <a
            href={`${API_BASE}/archive/connect/${status.provider.toLowerCase()}`}
            className={cn(
              'inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold',
              'bg-primary text-primary-foreground transition-all hover:bg-primary/90',
            )}
          >
            Connect
          </a>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ArchiveCards({
  statuses: initialStatuses,
  connected,
  connectedProvider,
  error,
}: {
  statuses:           ArchiveStatus[];
  connected?:         string;
  connectedProvider?: string;
  error?:             string;
}) {
  const [statuses, setStatuses] = useState(initialStatuses);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Show toast on ?connected=true redirect from OAuth callback
  useEffect(() => {
    if (connected === 'true' && connectedProvider) {
      const label = statuses.find((s) => s.provider === connectedProvider)?.label ?? connectedProvider;
      setToast({ message: `${label} connected successfully`, type: 'success' });
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
    if (error) {
      setToast({ message: decodeURIComponent(error), type: 'error' });
      const t = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(t);
    }
  }, [connected, connectedProvider, error, statuses]);

  async function handleDisconnect(provider: string) {
    const devTenant = process.env.NEXT_PUBLIC_DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';
    const headers: Record<string, string> = {};
    if (process.env.NODE_ENV !== 'production') headers['x-dev-tenant-id'] = devTenant;

    await fetch(`${API_BASE}/archive/disconnect/${provider.toLowerCase()}`, {
      method: 'DELETE',
      headers,
    });

    setStatuses((prev) =>
      prev.map((s) => s.provider === provider ? { ...s, isConnected: false } : s),
    );
    const label = statuses.find((s) => s.provider === provider)?.label ?? provider;
    setToast({ message: `${label} disconnected`, type: 'success' });
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3">
        {statuses.map((status) => (
          <ProviderCard
            key={status.provider}
            status={status}
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  );
}
