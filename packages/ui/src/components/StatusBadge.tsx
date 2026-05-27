import type { InvoiceStatus } from '@invoice/shared-types';
import { Badge } from './Badge';

const STATUS_COLOR: Record<InvoiceStatus, 'blue' | 'green' | 'red' | 'orange' | 'gray'> = {
  DRAFT:     'gray',
  SENT:      'blue',
  PAID:      'green',
  OVERDUE:   'red',
  CANCELLED: 'orange',
  VOID:      'gray',
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge color={STATUS_COLOR[status]}>{status}</Badge>;
}
