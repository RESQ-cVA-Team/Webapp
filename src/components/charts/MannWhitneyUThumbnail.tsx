'use client';

import { AlertCircle, CheckCircle2, SkipForward } from 'lucide-react';
import type { StatisticalTestResultDTO } from '@/models/dto/response';

interface MannWhitneyUThumbnailProps {
  result: StatisticalTestResultDTO;
}

export function MannWhitneyUThumbnail({ result }: MannWhitneyUThumbnailProps) {
  if (result.status === 'skipped') {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-lg  p-3">
        <div className="flex flex-col items-center gap-2 text-center">
          <SkipForward className="h-5 w-5 text-yellow-600" />
          <div className="text-xs font-semibold">Skipped</div>
        </div>
      </div>
    );
  }

  if (result.status === 'error') {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-lg p-3 text-red-900">
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <div className="text-xs font-semibold">Error</div>
        </div>
      </div>
    );
  }

  const passed = result.passed === true;
  const significanceLabel =
    result.status === 'success' ? (passed ? 'Significant' : 'Not significant') : result.status;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg  p-3 text-center">
      <div className="flex items-center gap-2">
        {passed ? (
          <CheckCircle2 className="h-5 w-5 text-green-600" />
        ) : (
          <AlertCircle className="h-5 w-5 text-red-600/50" />
        )}
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Mann-Whitney U
        </div>
      </div>

      <div className="text-lg font-bold text-foreground">
        p = {result.p_value?.toFixed(3) || 'N/A'}
      </div>

      <div className="rounded-full border bg-muted/40 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
        {significanceLabel}
      </div>
    </div>
  );
}