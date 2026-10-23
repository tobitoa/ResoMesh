'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Boxes,
  CheckCircle2,
  Database,
  History,
  Layers,
  Play,
  ShieldCheck,
  Users,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { isBusyStatus } from '@/lib/constants';
import type { MatchResult, Run, Validation } from '@/lib/types';
import { MetricCard } from '@/components/dashboard/metric-card';
import { RecentRuns } from '@/components/dashboard/recent-runs';
import { Workflow, type WorkflowStep } from '@/components/dashboard/workflow';
import { MatchReview, type MatchReviewItem } from '@/components/dashboard/match-review';
import { MetricSkeleton } from '@/components/ui/loading-state';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { ResultDrawer } from '@/components/results/result-drawer';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';

function buildWorkflow(status: Run['status'] | undefined, hasValidData: boolean, stage?: Run['stage'] | null): WorkflowStep[] {
  if (status === 'completed') {
    return [
      { label: 'Source Ingestion', descriptor: 'Source 1, 2, 3 TSVs validated', state: 'complete' },
      { label: 'Text Normalization', descriptor: 'Multi-lingual legal form & token sorting', state: 'complete' },
      { label: 'Candidate Generation', descriptor: 'Multi-pass signal-ranked blocking', state: 'complete' },
      { label: 'Pairwise Scoring', descriptor: 'Similarity vector feature scoring', state: 'complete' },
      { label: 'Decision Decoding', descriptor: 'Threshold filter ≥ 0.72', state: 'complete' },
      { label: 'Output & Validation', descriptor: 'Leaderboard TSV export & schema check', state: 'complete' },
    ];
  }

  if (isBusyStatus(status || '')) {
    const stageIndex: Record<string, number> = {
      queued: 0,
      validating: 0,
      preprocessing: 1,
      candidate_generation: 2,
      matching: 3,
      validation: 5,
    };
    const activeIndex = stageIndex[stage || status || 'queued'] ?? 0;
    return [
      { label: 'Source Ingestion', descriptor: 'Source 1, 2, 3 TSVs validated', state: activeIndex > 0 ? 'complete' : 'active' },
      { label: 'Text Normalization', descriptor: 'Multi-lingual legal form & token sorting', state: activeIndex > 1 ? 'complete' : activeIndex === 1 ? 'active' : 'pending' },
      { label: 'Candidate Generation', descriptor: 'Multi-pass signal-ranked blocking', state: activeIndex > 2 ? 'complete' : activeIndex === 2 ? 'active' : 'pending' },
      { label: 'Pairwise Scoring', descriptor: 'Similarity vector feature scoring', state: activeIndex > 3 ? 'complete' : activeIndex === 3 ? 'active' : 'pending' },
      { label: 'Decision Decoding', descriptor: 'Threshold filter ≥ 0.72', state: activeIndex > 4 ? 'complete' : activeIndex === 4 ? 'active' : 'pending' },
      { label: 'Output & Validation', descriptor: 'Leaderboard TSV export & schema check', state: activeIndex === 5 ? 'active' : 'pending' },
    ];
  }

  if (hasValidData) {
    return [
      { label: 'Source Ingestion', descriptor: '3 source catalogs uploaded & validated', state: 'complete' },
      { label: 'Text Normalization', descriptor: 'Ready for legal form & token cleaning', state: 'pending' },
      { label: 'Candidate Generation', descriptor: 'Multi-pass signal-ranked blocking', state: 'pending' },
      { label: 'Pairwise Scoring', descriptor: 'Similarity vector feature scoring', state: 'pending' },
      { label: 'Decision Decoding', descriptor: 'Threshold filter ≥ 0.72', state: 'pending' },
      { label: 'Output & Validation', descriptor: 'Leaderboard TSV export & schema check', state: 'pending' },
    ];
  }

  return [
    { label: 'Source Ingestion', descriptor: 'Upload source1, source2, source3 TSVs', state: 'pending' },
    { label: 'Text Normalization', descriptor: 'Multi-lingual legal form & token cleaning', state: 'pending' },
    { label: 'Candidate Generation', descriptor: 'Multi-pass signal-ranked blocking', state: 'pending' },
    { label: 'Pairwise Scoring', descriptor: 'Similarity vector feature scoring', state: 'pending' },
    { label: 'Decision Decoding', descriptor: 'Threshold filter ≥ 0.72', state: 'pending' },
    { label: 'Output & Validation', descriptor: 'Leaderboard TSV export & schema check', state: 'pending' },
  ];
}

export default function DashboardPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [datasetsValid, setDatasetsValid] = useState(false);
  const [metrics, setMetrics] = useState({
    source1Records: null as number | null,
    candidatePairs: null as number | null,
    matched: null as number | null,
    unmatched: null as number | null,
    f05: null as number | null,
    precision: null as number | null,
    matchRate: null as string | null,
  });
  const [featuredItem, setFeaturedItem] = useState<MatchReviewItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [activeRunId, setActiveRunId] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError('');
      setIsOffline(false);

      try {
        const [allRuns, datasets] = await Promise.all([
          api.runs(),
          api.datasets().catch(() => null),
        ]);

        if (!alive) return;

        setRuns(allRuns || []);
        const valid = datasets ? datasets.length === 3 && datasets.every(item => item.valid) : false;
        setDatasetsValid(valid);

        const completed = (allRuns || []).find(item => item.status === 'completed');
        if (completed) {
          setActiveRunId(completed.run_id);

          // Fetch preview results & validation
          const [preview, valData] = await Promise.all([
            api.results(new URLSearchParams({ run_id: completed.run_id, page: '1', page_size: '5' })).catch(() => null),
            api.validation(completed.run_id).catch(() => null),
          ]);

          if (alive) {
            const totalRecs = completed.record_count ?? completed.records_processed ?? 0;
            const matchedRecs = completed.matched_count ?? 0;
            const matchRateStr = totalRecs > 0 ? `${Math.round((matchedRecs / totalRecs) * 100)}%` : '—';

            setMetrics({
              source1Records: totalRecs,
              candidatePairs: completed.candidate_count ?? 0,
              matched: matchedRecs,
              unmatched: completed.unmatched_count ?? Math.max(0, totalRecs - matchedRecs),
              f05: valData?.f05 ?? null,
              precision: valData?.precision ?? null,
              matchRate: matchRateStr,
            });

            // Extract real featured match from results
            if (preview && preview.items.length > 0) {
              const matchedItem = preview.items.find(it => it.status === 'matched') || preview.items[0];
              if (matchedItem) {
                const detail = await api.result(matchedItem.source1_entity_id, completed.run_id).catch(() => null);
                const candidatesList = (detail?.candidates || [])
                  .filter(candidate => String(candidate.is_match).toLowerCase() === 'true')
                  .map(candidate => {
                    const similarity = Number(candidate.score);
                    return {
                      entity_id: candidate.candidate_entity_id,
                      source: candidate.candidate_source,
                      business_name: candidate.candidate_business_name,
                      business_address: candidate.candidate_address,
                      country: candidate.candidate_country,
                      similarity: Number.isFinite(similarity) ? similarity : 0,
                      confidence: (similarity >= 0.9 ? 'high' : similarity >= 0.75 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
                      signals: [],
                    };
                  });

                if (candidatesList.length > 0) {
                  setFeaturedItem({
                    entity_id: matchedItem.source1_entity_id,
                    business_name: matchedItem.business_name,
                    business_address: matchedItem.business_address,
                    country: matchedItem.country,
                    confidence: Number(matchedItem.confidence) || 0.94,
                    matches_count: matchedItem.matched_entity_ids.length,
                    candidates: candidatesList,
                  });
                } else {
                  setFeaturedItem(null);
                }
              }
            } else {
              setFeaturedItem(null);
            }
          }
        } else {
          // No completed runs yet
          setMetrics({
            source1Records: null,
            candidatePairs: null,
            matched: null,
            unmatched: null,
            f05: null,
            precision: null,
            matchRate: null,
          });
          setFeaturedItem(null);
        }
      } catch (err) {
        if (alive) {
          setIsOffline(true);
          setError('RESOMESH Backend Offline — The aws-main-ml service is not reachable. Check the backend service and try again.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [attempt]);

  const latestRun = runs[0];

  return (
    <>
      <div className="workspace-hero">
        <div className="workspace-hero-head">
          <div>
            <div className="workspace-lab-badge">aws-main-ml PIPELINE</div>
            <h1 className="workspace-hero-title">Entity Resolution Operations</h1>
            <p className="workspace-hero-desc">
              High-precision deduplication and cross-registry entity alignment powered by the authoritative aws-main-ml blocking and similarity models.
            </p>
          </div>
          <div className="workspace-hero-actions">
            <Link className="button button-secondary" href="/upload">
              <Database size={15} />
              Upload Datasets
            </Link>
            <Link className="button button-primary" href="/run">
              <Play size={15} />
              Run Matcher
            </Link>
          </div>
        </div>

        {/* System Flow Architecture */}
        <div className="workspace-flow-diagram">
          <div className="workspace-flow-node">
            <span className="workspace-flow-tag">01 / Input</span>
            <span className="workspace-flow-val">3 Source Catalogs</span>
            <span className="workspace-flow-sub">Source 1 · Source 2 · Source 3</span>
          </div>
          <div className="workspace-flow-arrow">→</div>
          <div className="workspace-flow-node node-highlight">
            <span className="workspace-flow-tag">02 / Blocking</span>
            <span className="workspace-flow-val">Multi-Pass Inverted Index</span>
            <span className="workspace-flow-sub">Signal-ranked candidate scoring</span>
          </div>
          <div className="workspace-flow-arrow">→</div>
          <div className="workspace-flow-node">
            <span className="workspace-flow-tag">03 / Resolution</span>
            <span className="workspace-flow-val">Pairwise ML Features</span>
            <span className="workspace-flow-sub">Rapidfuzz & composite similarity</span>
          </div>
          <div className="workspace-flow-arrow">→</div>
          <div className="workspace-flow-node">
            <span className="workspace-flow-tag">04 / Output</span>
            <span className="workspace-flow-val">Official Submission TSVs</span>
            <span className="workspace-flow-sub">Strict schema validation</span>
          </div>
        </div>
      </div>

      {isOffline && (
        <div className="mb-4 mt-6">
          <ErrorState
            title="RESOMESH Backend Offline"
            message="The aws-main-ml service is not reachable. Check that uvicorn backend.app.main:app is running and try again."
            onRetry={() => setAttempt(v => v + 1)}
          />
        </div>
      )}

      {/* Metrics Grid */}
      <div className="mt-6">
        {loading ? (
          <div className="metric-grid metric-grid-5">
            {Array.from({ length: 5 }, (_, index) => (
              <MetricSkeleton key={index} />
            ))}
          </div>
        ) : (
          <div className="metric-grid metric-grid-5">
            <MetricCard
              label="Source 1 Records"
              value={metrics.source1Records}
              note={metrics.source1Records != null ? 'Primary anchor records' : 'No run executed yet'}
              icon={Database}
              tone="blue"
            />
            <MetricCard
              label="Candidate Pairs"
              value={metrics.candidatePairs}
              note={metrics.candidatePairs != null ? 'Indexed pairs evaluated' : 'No run executed yet'}
              icon={Boxes}
              tone="lavender"
            />
            <MetricCard
              label="Confirmed Matches"
              value={metrics.matched}
              note={metrics.matched != null ? `Threshold score ≥ 0.72` : 'No run executed yet'}
              icon={Users}
              tone="pink"
            />
            <MetricCard
              label="Singletons (Unmatched)"
              value={metrics.unmatched}
              note={metrics.unmatched != null ? 'Zero matching candidates' : 'No run executed yet'}
              icon={Layers}
              tone="peach"
            />
            <MetricCard
              label="Validation F₀.₅"
              value={metrics.f05 != null ? metrics.f05.toFixed(3) : metrics.matchRate != null ? metrics.matchRate : '—'}
              note={metrics.f05 != null ? 'Official ground-truth F₀.₅' : metrics.matchRate != null ? 'Observed match rate' : 'No validation available'}
              icon={ShieldCheck}
              tone="green"
            />
          </div>
        )}
      </div>

      {/* Full-width Resolution Pipeline Block */}
      <section className="card section mt-6 pipeline-card">
        <div className="card-header">
          <div>
            <h2 className="section-title">Resolution Pipeline</h2>
            <p className="section-description">End-to-end execution state across ingestion, matching, and validation</p>
          </div>
          <StatusIndicator status={latestRun?.status || (datasetsValid ? 'valid' : 'queued')} />
        </div>
        <div className="card-body">
          <Workflow steps={buildWorkflow(latestRun?.status, datasetsValid, latestRun?.stage)} label="Resolution workflow" />
          <div className="pipeline-summary-box mt-5">
            {latestRun?.status === 'completed' ? (
              <>
                <CheckCircle2 size={16} className="text-success flex-none" />
                <p className="pipeline-summary-text">
                  <strong>All required stages completed.</strong> Run <code className="mono">{latestRun.run_id}</code> produced official matching results and candidate pairs validated against decision threshold &ge; 0.72.
                </p>
              </>
            ) : latestRun && isBusyStatus(latestRun.status) ? (
              <>
                <span className="spinner spinner-sm flex-none" />
                <p className="pipeline-summary-text">
                  <strong>Pipeline executing.</strong> Candidate generation and similarity scoring in progress in aws-main-ml backend.
                </p>
              </>
            ) : (
              <>
                <div className="pipeline-dot" />
                <p className="pipeline-summary-text">
                  {datasetsValid
                    ? 'All three data sources validated with required schemas. aws-main-ml model is ready for execution.'
                    : 'Upload Source 1, Source 2, and Source 3 dataset files to initiate background resolution.'}
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Full-width Recent Runs Data Block */}
      <div className="section mt-6">
        <RecentRuns runs={runs} />
      </div>

      {/* Real Match Review Section */}
      {featuredItem && (
        <div className="section mt-6">
          <MatchReview
            item={featuredItem}
            onViewDetails={id => setSelectedEntityId(id)}
          />
        </div>
      )}

      {/* Entity Dossier Drawer */}
      {selectedEntityId && (
        <ResultDrawer
          entityId={selectedEntityId}
          runId={activeRunId}
          onClose={() => setSelectedEntityId('')}
        />
      )}
    </>
  );
}
