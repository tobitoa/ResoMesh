'use client';

import Link from 'next/link';
import { ArrowRight, History } from 'lucide-react';
import type { Run } from '@/lib/types';
import { isBusyStatus } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

interface RecentRunsProps {
  runs: Run[];
  action?: React.ReactNode;
}

export function RecentRuns({ runs, action }: RecentRunsProps) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="section-title">Recent runs</h2>
          <p className="section-description">Historical pipeline execution telemetry</p>
        </div>
        {action !== undefined ? (
          action
        ) : (
          <Link className="button button-sm button-ghost" href="/run">
            Start New Run
            <ArrowRight size={13} />
          </Link>
        )}
      </div>

      {runs.length ? (
        <div className="table-responsive">
          <table className="table table-runs">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Time & Duration</th>
                <th>Sources</th>
                <th className="num">Records</th>
                <th className="num">Matches</th>
                <th className="num">F₀.₅</th>
                <th>Status</th>
                <th className="action">Action</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 6).map(run => {
                const duration = run.duration || (run.completed_at && run.started_at
                  ? `${Math.max(1, Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000))}s`
                  : '—');
                const f05Val = run.f05 != null ? run.f05.toFixed(3) : '—';

                return (
                  <tr key={run.run_id}>
                    <td>
                      <span className="mono text-xs font-semibold">{run.run_id}</span>
                    </td>
                    <td>
                      <div className="run-time-cell">
                        <span className="text-xs">{formatDate(run.started_at || run.created_at)}</span>
                        <span className="text-2xs text-muted mono">{duration}</span>
                      </div>
                    </td>
                    <td>
                      <div className="sources-tag-cluster">
                        <span className="src-mini-tag src-mini-tag-s1" title="Source 1 (Reference)">S1</span>
                        <span className="src-mini-tag src-mini-tag-s2" title="Source 2 (Target)">S2</span>
                        <span className="src-mini-tag src-mini-tag-s3" title="Source 3 (Supplemental)">S3</span>
                      </div>
                    </td>
                    <td className="num mono">{run.record_count?.toLocaleString() ?? run.records_processed?.toLocaleString() ?? '—'}</td>
                    <td className="num mono">{run.matched_count?.toLocaleString() ?? '—'}</td>
                    <td className="num mono font-medium">
                      {f05Val}
                    </td>
                    <td>
                      <Badge
                        tone={
                          run.status === 'completed'
                            ? 'success'
                            : isBusyStatus(run.status)
                              ? 'info'
                              : run.status === 'failed'
                                ? 'error'
                                : 'neutral'
                        }
                      >
                        {run.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="action">
                      <div className="inline-actions">
                        <Link
                          className="button button-xs button-secondary"
                          href={`/results?run_id=${encodeURIComponent(run.run_id)}`}
                        >
                          Results
                        </Link>
                        <Link
                          className="button button-xs button-ghost"
                          href={`/validation?run_id=${encodeURIComponent(run.run_id)}`}
                        >
                          Validate
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={History}
          title="No execution runs yet"
          description="Execute the entity resolution pipeline to generate candidate pairs and matching results."
          action={
            <Link className="button button-primary" href="/run">
              Start First Run
            </Link>
          }
        />
      )}
    </section>
  );
}
