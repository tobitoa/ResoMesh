'use client';

import Link from 'next/link';
import { Download, Play, CheckCircle2, FileSpreadsheet, Eye } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isBusyStatus, SOURCE_LABELS, SOURCES } from '@/lib/constants';
import type { Dataset, Health, Run, Source } from '@/lib/types';
import { PageHeading } from '@/components/ui/page-heading';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { ErrorState } from '@/components/ui/error-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { EmptyState } from '@/components/ui/empty-state';
import { Toast } from '@/components/ui/toast';
import { CardSkeleton } from '@/components/ui/loading-state';
import { Workflow, type WorkflowState, type WorkflowStep } from '@/components/dashboard/workflow';
import { RecentRuns } from '@/components/dashboard/recent-runs';

const PIPELINE_LABELS = ['Input', 'Preprocessing', 'Feature Extraction', 'AI Matching', 'Resolution', 'Confidence'];

function buildPipeline(status: Run['status'] | undefined, stage: Run['stage'] | null | undefined): WorkflowStep[] {
  const currentStage = stage || status;
  const stageIndex: Record<string, number> = {
    queued: 0,
    validating: 0,
    preprocessing: 1,
    candidate_generation: 2,
    matching: 3,
    validation: 5,
  };

  const getStepState = (index: number): WorkflowState => {
    if (!status) return 'pending';
    if (status === 'completed') return 'complete';
    if (status === 'failed' || status === 'cancelled') {
      const failedIndex = stageIndex[stage || ''] ?? 0;
      return index < failedIndex ? 'complete' : index === failedIndex ? 'failed' : 'pending';
    }
    const activeIndex = stageIndex[currentStage || ''] ?? 0;
    if (index < activeIndex) return 'complete';
    if (index === activeIndex) return 'active';
    return 'pending';
  };

  return PIPELINE_LABELS.map((label, idx) => ({
    label,
    state: getStepState(idx),
  }));
}

export default function RunPage() {
  const [run, setRun] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [allRuns, data, status] = await Promise.all([
        api.runs().catch(() => null),
        api.datasets().catch(() => null),
        api.health().catch(() => null),
      ]);

      setDatasets(data || []);
      setHealth(status);

      if (allRuns && allRuns.length > 0) {
        setRuns(allRuns);
        const stored = typeof window !== 'undefined' ? (localStorage.getItem('resomesh-run-id') || localStorage.getItem('convia-run-id')) : null;
        const selected = (stored && allRuns.find(item => item.run_id === stored)) || allRuns[0];
        if (selected) setRun(selected);
      } else {
        setRuns([]);
        setRun(null);
      }
      setError('');
    } catch {
      setRuns([]);
      setRun(null);
      setError('Unable to connect to backend execution service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Real-time polling when run is queued or running
  useEffect(() => {
    const activeRunId = run?.run_id;
    const activeStatus = run?.status;
    if (!activeRunId || !activeStatus || !isBusyStatus(activeStatus)) return;

    const timer = window.setInterval(async () => {
      try {
        const updated = await api.run(activeRunId);
        setRun(updated);
        if (!isBusyStatus(updated.status)) {
          localStorage.setItem('resomesh-run-id', updated.run_id);
          setMessage(updated.status === 'completed' ? 'Matching run completed successfully.' : 'Matching run stopped with error.');
          // Refresh runs list
          const refreshed = await api.runs();
          setRuns(refreshed);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not refresh execution status.');
      }
    }, 900);

    return () => window.clearInterval(timer);
  }, [run?.run_id, run?.status]);

  const valid = datasets.length === 3 && datasets.every(item => item.valid);

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const created = await api.startRun();
      setRun(created);
      localStorage.setItem('resomesh-run-id', created.run_id);
      setRuns(current => [created, ...current]);
      setMessage('Background entity resolution job queued.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not trigger matching execution.');
    } finally {
      setStarting(false);
    }
  };

  const isBusy = run ? isBusyStatus(run.status) : false;

  const summary = !run
    ? { title: 'Ready to Run', text: 'Start the resolver on the three validated input datasets.' }
    : isBusy
      ? { title: 'Processing In Progress', text: `Backend job status: ${run.status}. Model is actively executing normalization, blocking, and similarity scoring in background thread.` }
      : run.status === 'completed'
        ? { title: 'Matching Execution Completed', text: `Successfully processed ${run.record_count ?? '—'} Source 1 records and generated ${run.candidate_count ?? '—'} candidate pairs.` }
        : { title: 'Execution Stopped', text: 'The run encountered an issue before completion. Review logs below.' };

  return (
    <>
      <PageHeading
        title="Run Matching"
        description="Execute background entity resolution jobs across uploaded datasets with honest, real-time stage progression."
        actions={
          <Link className="button button-secondary" href="/upload">
            Manage Datasets
          </Link>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorState title="Execution Service Notice" message={error} onRetry={load} />
        </div>
      ) : null}

      {loading ? (
        <div className="split-layout">
          <CardSkeleton />
          <CardSkeleton lines={3} />
        </div>
      ) : !valid ? (
        <div className="data-panel">
          <EmptyState
            icon={Play}
            title="Three Valid Sources Required"
            description="Please upload Source 1, Source 2, and Source 3 files to start resolution."
            action={
              <Link className="button button-primary" href="/upload">
                Configure Datasets
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="split-layout">
            {/* Left column: Input Sources Status */}
            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="section-title">Input Sources Status</h2>
                  <p className="section-description">Three validated tabular feeds</p>
                </div>
              </div>
              <div className="card-body stack-list">
                {SOURCES.map((source: Source) => {
                  const item = datasets.find(dataset => dataset.source === source);
                  return (
                    <div className="source-mini" key={source}>
                      <div>
                        <div className="source-mini-title flex items-center gap-1.5">
                          <span className="font-semibold">{SOURCE_LABELS[source]}</span>
                          {item?.valid && <CheckCircle2 size={13} className="text-success" />}
                        </div>
                        <div className="source-mini-meta mono">
                          {item ? `${item.record_count ?? '—'} rows · ${item.filename}` : 'Missing'}
                        </div>
                      </div>
                      <Badge tone={item?.valid ? 'success' : 'error'}>
                        {item?.valid ? '✓ loaded' : 'missing'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Right column: Execution Console */}
            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="section-title">Job Telemetry & Control</h2>
                  <p className="section-description">Live state reported by the background execution thread</p>
                </div>
                {run ? <StatusIndicator status={run.status} /> : null}
              </div>

              <div className="card-body stack-list">
                <div className="run-summary">
                  <div>
                    <div className="run-summary-title">{summary.title}</div>
                    <p className="run-summary-text">{summary.text}</p>
                  </div>
                  <Button variant="primary" onClick={() => void start()} disabled={starting || isBusy}>
                    <Play size={15} />
                    {starting ? 'Starting…' : isBusy ? 'Processing…' : 'Run Matching Job'}
                  </Button>
                </div>

                <div className="run-stats">
                  <div>
                    <div className="run-stat-label">Status</div>
                    <div className="run-stat-value mono font-semibold">{run?.status ?? 'idle'}</div>
                  </div>
                  <div>
                    <div className="run-stat-label">Records Processed</div>
                    <div className="run-stat-value mono">
                      {run?.records_processed ?? run?.record_count ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="run-stat-label">Candidate Pairs</div>
                    <div className="run-stat-value mono">{run?.candidate_count ?? '—'}</div>
                  </div>
                  <div>
                    <div className="run-stat-label">Matched · Unmatched</div>
                    <div className="run-stat-value mono text-primary">
                      {run?.matched_count ?? '—'} · {run?.unmatched_count ?? '—'}
                    </div>
                  </div>
                </div>

                {/* AI Matching Engine Architecture Flow */}
                <div className="matching-engine-panel">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-sm text-primary">AI Matching Architecture</div>
                      <div className="text-xs text-secondary">Multi-signal blocking & composite similarity engine</div>
                    </div>
                    <Badge tone="accent">Multi-Signal Pipeline</Badge>
                  </div>
                  <div className="matching-engine-flow">
                    <div className={`matching-engine-step ${isBusy || run?.status === 'completed' ? 'active' : ''}`}>
                      <span className="matching-engine-step-tag">01 / Input</span>
                      <span className="matching-engine-step-title">Source Catalogs</span>
                      <span className="matching-engine-step-desc">Amazon · Google · Flipkart</span>
                    </div>
                    <div className="workspace-flow-arrow">→</div>
                    <div className={`matching-engine-step ${isBusy || run?.status === 'completed' ? 'active' : ''}`}>
                      <span className="matching-engine-step-tag">02 / Features</span>
                      <span className="matching-engine-step-title">Vectors & TF-IDF</span>
                      <span className="matching-engine-step-desc">Dense n-grams & clean titles</span>
                    </div>
                    <div className="workspace-flow-arrow">→</div>
                    <div className={`matching-engine-step ${run?.status === 'completed' ? 'active' : ''}`}>
                      <span className="matching-engine-step-tag">03 / Alignment</span>
                      <span className="matching-engine-step-title">Candidate Pairs</span>
                      <span className="matching-engine-step-desc">{run?.candidate_count ?? '—'} pairwise candidates</span>
                    </div>
                    <div className="workspace-flow-arrow">→</div>
                    <div className={`matching-engine-step ${run?.status === 'completed' ? 'active' : ''}`}>
                      <span className="matching-engine-step-tag">04 / Confidence</span>
                      <span className="matching-engine-step-title">Cluster Resolution</span>
                      <span className="matching-engine-step-desc">Resolver threshold ≥ 0.72</span>
                    </div>
                  </div>
                </div>

                {/* Pipeline visualizer */}
                <div className="workflow-host">
                  <div className="drawer-section-title">
                    <span>Resolution Pipeline</span>
                    <span className="mono text-xs text-muted">{run ? `run ${run.run_id}` : 'ready'}</span>
                  </div>
                  <Workflow steps={buildPipeline(run?.status, run?.stage)} label="Run pipeline" />
                  <p className="helper-text mt-3">
                    Stages reflect verified worker state. The pipeline transitions automatically as jobs complete.
                  </p>
                </div>

                {run?.error ? <ErrorNotice message={run.error} /> : null}

                {/* Output Files Actions */}
                {run?.status === 'completed' ? (
                  <div className="output-files-panel mt-3">
                    <div className="output-files-title flex items-center gap-2 mb-2 font-medium text-sm">
                      <FileSpreadsheet size={16} className="text-accent" />
                      <span>Generated Artifacts</span>
                    </div>
                    <div className="inline-actions">
                      <Link className="button button-primary" href="/results">
                        <Eye size={14} />
                        View Results
                      </Link>
                      <a className="button button-secondary" href={api.downloadUrl(run.run_id, 'matching')}>
                        <Download size={14} />
                        matching_results.tsv
                      </a>
                      <a className="button button-secondary" href={api.downloadUrl(run.run_id, 'candidates')}>
                        <Download size={14} />
                        candidate_pairs.tsv
                      </a>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <div className="section mt-6">
            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="section-title">Execution Configuration</h2>
                  <p className="section-description">Resolver parameters & metadata</p>
                </div>
              </div>
              <div className="card-body run-config">
                <div>
                  <div className="run-stat-label">Resolver Engine</div>
                  <div className="run-stat-value">{run?.model ?? health?.model_name ?? 'Amazon ML ER Pipeline (Multi-Pass Signal-Ranked)'}</div>
                </div>
                <div>
                  <div className="run-stat-label">Execution Mode</div>
                  <div className="run-stat-value mono">{run?.mode ?? health?.model_mode ?? 'deterministic'}</div>
                </div>
                <div>
                  <div className="run-stat-label">Active Run ID</div>
                  <div className="run-stat-value mono text-primary">{run?.run_id ?? '—'}</div>
                </div>
              </div>
            </section>
          </div>

          <div className="section mt-6">
            <RecentRuns runs={runs} />
          </div>
        </>
      )}

      <Toast message={message} onClose={() => setMessage('')} />
    </>
  );
}
