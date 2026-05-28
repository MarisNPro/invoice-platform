'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { ImportListItem } from '@/lib/api';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CFG = {
  PENDING: {
    label: 'Pending',
    cls: 'bg-muted text-muted-foreground',
  },
  PROCESSING: {
    label: 'Reviewing',
    cls: 'bg-blue-500/15 text-blue-400',
  },
  COMPLETED: {
    label: 'Confirmed',
    cls: 'bg-success/15 text-success',
  },
  FAILED: {
    label: 'Failed',
    cls: 'bg-destructive/15 text-destructive',
  },
} as const satisfies Record<ImportListItem['status'], { label: string; cls: string }>;

function StatusBadge({ status }: { status: ImportListItem['status'] }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.PENDING;
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums', cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ── Confidence pill ───────────────────────────────────────────────────────────

function ConfPill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  const cls =
    pct >= 85 ? 'text-success' :
    pct >= 70 ? 'text-amber-400' :
    'text-destructive';
  return <span className={cn('tabular-nums font-medium', cls)}>{pct}%</span>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImportsTable({ rows }: { rows: ImportListItem[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-20 text-center">
        <p className="text-lg font-semibold">No imports yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a PDF invoice to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {['File', 'Status', 'Confidence', 'Created', 'Invoice'].map((h) => (
              <th
                key={h}
                className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => router.push(`/imports/${row.id}/review`)}
              className={cn(
                'border-b border-border/50 last:border-0',
                'cursor-pointer transition-colors hover:bg-muted/20',
                // Dim confirmed / failed rows slightly so unreviewed ones stand out
                (row.status === 'FAILED') && 'opacity-60',
              )}
            >
              {/* File name */}
              <td className="px-5 py-3.5">
                <span className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                    />
                  </svg>
                  <span className="max-w-[220px] truncate font-medium text-foreground">
                    {row.fileName}
                  </span>
                </span>
              </td>

              {/* Status */}
              <td className="px-5 py-3.5">
                <StatusBadge status={row.status} />
              </td>

              {/* Confidence */}
              <td className="px-5 py-3.5">
                <ConfPill pct={row.confidencePct} />
              </td>

              {/* Created */}
              <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                {fmtDate(row.createdAt)}
              </td>

              {/* Linked invoice */}
              <td className="px-5 py-3.5">
                {row.confirmedInvoiceNumber ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/invoices/${row.confirmedInvoiceNumber}`);
                    }}
                    className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                  >
                    {row.confirmedInvoiceNumber}
                  </button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
