import {
  Boxes,
  Database,
  LayoutGrid,
  Play,
  ShieldCheck,
  Table2,
  BookOpen,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { Source } from './types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutGrid },
  { href: '/run', label: 'Run Match', icon: Play },
  { href: '/candidates', label: 'Candidates', icon: Boxes },
  { href: '/results', label: 'Results', icon: Table2 },
  { href: '/validation', label: 'Validation', icon: ShieldCheck },
  { href: '/upload', label: 'Datasets', icon: Database },
  { href: '/methodology', label: 'Methodology', icon: BookOpen },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export const SOURCES: Source[] = ['source1', 'source2', 'source3'];

export const SOURCE_LABELS: Record<Source, string> = {
  source1: 'Source 1',
  source2: 'Source 2',
  source3: 'Source 3',
};

export const SOURCE_DESCRIPTIONS: Record<Source, string> = {
  source1: 'Primary business records to resolve and index.',
  source2: 'Secondary commercial registry / candidate source.',
  source3: 'Third directory source / candidate source.',
};

export const REQUIRED_COLUMNS = ['entity_id', 'business_name', 'business_address', 'country'] as const;

export function isBusyStatus(status: string): boolean {
  return [
    'queued',
    'validating',
    'preprocessing',
    'candidate_generation',
    'matching',
    'validation',
  ].includes(status);
}
