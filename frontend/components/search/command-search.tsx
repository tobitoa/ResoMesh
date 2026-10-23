'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  X,
  ArrowRight,
  Play,
  Upload,
  Database,
  CheckCircle2,
  FileText,
  GitMerge,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { NAV_ITEMS } from '@/lib/constants';
import { api, searchApi } from '@/lib/api';
import type { SearchResponse } from '@/lib/types';

interface CommandSearchProps {
  open: boolean;
  onClose: () => void;
}

interface ActionItem {
  id: string;
  type: 'action';
  title: string;
  subtitle: string;
  href: string;
  icon: LucideIcon;
}

const QUICK_ACTIONS: ActionItem[] = [
  { id: 'act-run', type: 'action', title: 'Execute Entity Resolution', subtitle: 'Launch aws-main-ml pipeline run', href: '/run', icon: Play },
  { id: 'act-upload', type: 'action', title: 'Upload Dataset Sources', subtitle: 'Manage Source 1, 2, and 3 TSVs', href: '/upload', icon: Upload },
  { id: 'act-results', type: 'action', title: 'Review Matching Results', subtitle: 'Inspect aligned cross-source entities', href: '/results', icon: Database },
  { id: 'act-candidates', type: 'action', title: 'Inspect Candidate Pairs', subtitle: 'Browse blocked entity candidates', href: '/candidates', icon: GitMerge },
  { id: 'act-validation', type: 'action', title: 'Validate Run Compliance', subtitle: 'Run official submission validator', href: '/validation', icon: CheckCircle2 },
];

export function CommandSearch({ open, onClose }: CommandSearchProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsListRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 40);
      setQuery('');
      setSearchData(null);
      setSearchError(false);
      setSelectedIndex(0);
    }
  }, [open]);

  // Handle global shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose();
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const executeSearch = useCallback(async (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) {
      setSearchData(null);
      setSearchError(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setSearchError(false);
    try {
      // Safe resolution of search method
      const fn = typeof api?.search === 'function' ? api.search : searchApi.search;
      const res = await fn(trimmed);
      setSearchData(res);
      setSearchError(false);
    } catch (err) {
      console.error('Command search API error:', err);
      setSearchError(true);
      setSearchData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced API search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchData(null);
      setSearchError(false);
      setLoading(false);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      void executeSearch(trimmed);
    }, 220);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, executeSearch]);

  // Build flattened selectable items list
  const activeItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: Array<{
      id: string;
      category: string;
      title: string;
      subtitle: string;
      href: string;
      icon: LucideIcon;
      onSelect: () => void;
      badge?: string;
    }> = [];

    // If user has typed a query and we have search results
    if (q && searchData) {
      // 1. Entities
      for (const ent of searchData.entities || []) {
        const href = `/results?search=${encodeURIComponent(ent.id)}`;
        items.push({
          id: `entity-${ent.id}`,
          category: 'Entities',
          title: ent.title,
          subtitle: ent.subtitle || `Entity ${ent.id}`,
          href,
          icon: Database,
          badge: ent.match_status === 'matched' ? 'MATCHED' : 'UNMATCHED',
          onSelect: () => {
            router.push(href);
            onClose();
          },
        });
      }

      // 2. Candidates
      for (const cand of searchData.candidates || []) {
        const href = `/candidates?search=${encodeURIComponent(cand.s1_id || cand.id)}`;
        items.push({
          id: `cand-${cand.id}`,
          category: 'Candidates',
          title: cand.title,
          subtitle: cand.subtitle || `Candidate ${cand.id}`,
          href,
          icon: GitMerge,
          badge: cand.score != null ? `${Math.round(cand.score * 100)}%` : undefined,
          onSelect: () => {
            router.push(href);
            onClose();
          },
        });
      }

      // 3. Runs
      for (const r of searchData.runs || []) {
        const href = `/results?run_id=${encodeURIComponent(r.id)}`;
        items.push({
          id: `run-${r.id}`,
          category: 'Runs',
          title: r.title,
          subtitle: r.subtitle || `Run ${r.id}`,
          href,
          icon: Play,
          badge: r.status?.toUpperCase(),
          onSelect: () => {
            router.push(href);
            onClose();
          },
        });
      }

      // 4. Datasets
      for (const ds of searchData.datasets || []) {
        const href = '/upload';
        items.push({
          id: `ds-${ds.id}`,
          category: 'Datasets',
          title: ds.title,
          subtitle: ds.subtitle || `Dataset ${ds.id}`,
          href,
          icon: FileText,
          badge: ds.valid ? 'VALID' : 'INVALID',
          onSelect: () => {
            router.push(href);
            onClose();
          },
        });
      }
    }

    // Matching Navigation & Quick Actions
    const matchingNav = NAV_ITEMS.filter(
      nav => !q || nav.label.toLowerCase().includes(q) || nav.href.toLowerCase().includes(q)
    );
    for (const nav of matchingNav) {
      items.push({
        id: `nav-${nav.href}`,
        category: 'Navigation',
        title: nav.label,
        subtitle: `Jump to ${nav.href}`,
        href: nav.href,
        icon: nav.icon,
        onSelect: () => {
          router.push(nav.href);
          onClose();
        },
      });
    }

    const matchingActions = QUICK_ACTIONS.filter(
      act => !q || act.title.toLowerCase().includes(q) || act.subtitle.toLowerCase().includes(q)
    );
    for (const act of matchingActions) {
      if (!items.some(i => i.id === `nav-${act.href}`)) {
        items.push({
          id: `act-${act.href}`,
          category: 'Quick Actions',
          title: act.title,
          subtitle: act.subtitle,
          href: act.href,
          icon: act.icon,
          onSelect: () => {
            router.push(act.href);
            onClose();
          },
        });
      }
    }

    return items;
  }, [query, searchData, router, onClose]);

  // Keep selection in bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [activeItems.length, query]);

  // Keyboard navigation within modal
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1 < activeItems.length ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 >= 0 ? prev - 1 : activeItems.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeItems[selectedIndex]) {
          activeItems[selectedIndex].onSelect();
        } else if (query.trim()) {
          router.push(`/results?search=${encodeURIComponent(query.trim())}`);
          onClose();
        }
      }
    },
    [activeItems, selectedIndex, query, router, onClose]
  );

  // Scroll active item into view
  useEffect(() => {
    if (!resultsListRef.current) return;
    const activeEl = resultsListRef.current.querySelector('.command-item-active') as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <div
      className="command-overlay"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Command search palette"
    >
      <div className="command-modal" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="command-search-head">
          {loading ? (
            <Loader2 size={18} className="command-search-icon spin" />
          ) : (
            <Search size={18} className="command-search-icon" />
          )}
          <input
            ref={inputRef}
            type="text"
            className="command-input"
            placeholder="Search entities, candidates, runs, datasets, or jump to page..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="command-close"
              onClick={() => setQuery('')}
              aria-label="Clear search query"
            >
              <X size={16} />
            </button>
          ) : (
            <kbd className="command-search-kbd" style={{ fontSize: 10, padding: '2px 6px' }}>ESC</kbd>
          )}
        </div>

        <div className="command-results-list" ref={resultsListRef}>
          {searchError ? (
            <div className="command-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '24px 16px' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                Search unavailable
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                The RESOMESH backend could not be reached.
              </div>
              <button
                type="button"
                className="button button-sm button-secondary"
                style={{ marginTop: 10, gap: 6 }}
                onClick={() => void executeSearch(query)}
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          ) : activeItems.length === 0 ? (
            <div className="command-empty">
              {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Loader2 size={16} className="spin" />
                  <span>Searching RESOMESH registry...</span>
                </div>
              ) : (
                <span>No results found for &ldquo;{query}&rdquo;</span>
              )}
            </div>
          ) : (
            activeItems.map((item, idx) => {
              const Icon = item.icon;
              const isActive = idx === selectedIndex;
              const isFirstOfCategory = idx === 0 || activeItems[idx - 1].category !== item.category;

              return (
                <div key={item.id}>
                  {isFirstOfCategory && (
                    <div
                      style={{
                        padding: '8px 12px 4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {item.category}
                    </div>
                  )}
                  <div
                    className={`command-item ${isActive ? 'command-item-active' : ''}`}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div className="command-item-icon">
                      <Icon size={14} />
                    </div>
                    <div className="command-item-content">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="command-item-title">{item.title}</span>
                        {item.badge && (
                          <span
                            style={{
                              fontSize: '9px',
                              fontWeight: 600,
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: 'var(--surface-3)',
                              color: 'var(--text-secondary)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <div className="command-item-sub">{item.subtitle}</div>
                    </div>
                    <ArrowRight size={13} className="command-item-hint" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="command-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            <span>Navigate</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <kbd>↵</kbd>
            <span>Select</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <kbd>ESC</kbd>
            <span>Close</span>
          </div>
          {query.trim() && (
            <div style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 500 }}>
              Press ↵ to view entity matches
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
