import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import type { ImportRecord } from '@/lib/api';
import { ReviewClient } from './ReviewClient';

export const metadata: Metadata = {
  title: 'Review Import | Invoice Platform',
};

export default async function ImportReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await apiGet<ImportRecord>(`/imports/${id}`);
  return <ReviewClient importId={id} initialData={data} />;
}
