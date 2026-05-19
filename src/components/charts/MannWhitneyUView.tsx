'use client';

import type { StatisticalTestResultDTO } from '@/models/dto/response';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, SkipForward } from 'lucide-react';

interface MannWhitneyUDetails {
  trace_id?: string;
  metric?: string;
  u_statistic?: number;
  cohort_a_label?: string;
  cohort_b_label?: string;
  cohort_a_size?: number;
  cohort_b_size?: number;
  cohort_a_median?: number;
  cohort_b_median?: number;
}

interface MannWhitneyUViewProps {
  result: StatisticalTestResultDTO;
}

export function MannWhitneyUView({ result }: MannWhitneyUViewProps) {
  const details = (result.details || {}) as MannWhitneyUDetails;

  if (result.status === 'skipped') {
    return (
      <Alert className="border-yellow-200 bg-yellow-50">
        <SkipForward className="h-4 w-4 text-yellow-600" />
        <AlertDescription className="text-yellow-800">
          <div className="font-semibold mb-1">Test Skipped</div>
          <div>{result.reason || 'Statistical test was not applicable'}</div>
        </AlertDescription>
      </Alert>
    );
  }

  if (result.status === 'error') {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-red-800">
          <div className="font-semibold mb-1">Test Error</div>
          <div>{result.reason || 'An error occurred while performing the statistical test'}</div>
        </AlertDescription>
      </Alert>
    );
  }

  if (result.status === 'success') {
    const passedIndicator = result.passed ? (
      <div className="flex items-center gap-2 text-green-700">
        <CheckCircle2 className="h-5 w-5" />
        <span className="font-semibold">Passed (p {'<'} α)</span>
      </div>
    ) : (
      <div className="flex items-center gap-2 text-red-700">
        <AlertCircle className="h-5 w-5" />
        <span className="font-semibold">Not Significant (p ≥ α)</span>
      </div>
    );

    return (
      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">{result.title || 'Mann-Whitney U Test'}</h3>
          <div className="mb-4">{passedIndicator}</div>
          <div className="text-2xl font-bold text-primary">
            p = {result.p_value?.toFixed(4) || 'N/A'}
          </div>
        </div>

        {/* Comparison Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3 font-semibold">Metric</th>
                <th className="text-center py-2 px-3 font-semibold">{details.cohort_a_label || 'Cohort A'}</th>
                <th className="text-center py-2 px-3 font-semibold">{details.cohort_b_label || 'Cohort B'}</th>
              </tr>
            </thead>
            <tbody>
              {details.metric && (
                <tr className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3 font-medium">Metric</td>
                  <td className="text-center py-2 px-3">{details.metric}</td>
                  <td className="text-center py-2 px-3">{details.metric}</td>
                </tr>
              )}
              <tr className="border-b hover:bg-muted/50">
                <td className="py-2 px-3 font-medium">Sample Size</td>
                <td className="text-center py-2 px-3">n = {details.cohort_a_size || '—'}</td>
                <td className="text-center py-2 px-3">n = {details.cohort_b_size || '—'}</td>
              </tr>
              <tr className="hover:bg-muted/50">
                <td className="py-2 px-3 font-medium">Median</td>
                <td className="text-center py-2 px-3">{details.cohort_a_median?.toFixed(2) || '—'}</td>
                <td className="text-center py-2 px-3">{details.cohort_b_median?.toFixed(2) || '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Test Statistic */}
        <div className="pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            U Statistic: <span className="font-semibold text-foreground">{details.u_statistic?.toFixed(2) || 'N/A'}</span>
          </div>
        </div>
      </Card>
    );
  }

  return null;
}
