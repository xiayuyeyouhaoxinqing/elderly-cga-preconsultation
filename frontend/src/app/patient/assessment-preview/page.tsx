import { notFound } from 'next/navigation';
import { runtimeConfig } from '@/lib/runtime/config';
import { AssessmentPreview } from './AssessmentPreview';

export default function AssessmentPreviewPage() {
  if (runtimeConfig.dataMode !== 'mock') notFound();
  return <AssessmentPreview />;
}
