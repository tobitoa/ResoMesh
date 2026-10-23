export type Source = 'source1' | 'source2' | 'source3';
export type RunStatus =
  | 'queued'
  | 'validating'
  | 'preprocessing'
  | 'candidate_generation'
  | 'matching'
  | 'validation'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type PipelineStatus = 'idle' | RunStatus;

export interface Health {
  ok: boolean;
  model_name: string;
  model_mode: string;
}

export type HealthState =
  | { status: 'checking' }
  | { status: 'offline'; error?: string }
  | {
      status: 'online';
      modelName: string;
      modelMode: string;
      mlReady: boolean;
    };

export interface Dataset {
  dataset_id: string;
  source: Source;
  filename: string;
  size_bytes: number;
  record_count: number | null;
  valid: boolean;
  errors: string[];
  columns: string[];
}

export interface Run {
  run_id: string;
  status: RunStatus;
  stage?: RunStatus | null;
  model: string;
  mode: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  records_processed: number | null;
  record_count: number | null;
  matched_count: number | null;
  unmatched_count: number | null;
  candidate_count: number | null;
  duration?: string;
  f05?: number;
  sources?: string[];
  error_stage?: string | null;
  error_category?: string | null;
}

export interface MatchResult {
  source1_entity_id: string;
  business_name: string;
  business_address: string;
  country: string;
  matched_entity_ids: string[];
  matched_entity_sources?: string[];
  confidence: number | string | null;
  status: 'matched' | 'unmatched';
}

export type Entity = MatchResult;
export type Match = MatchResult;

export interface Candidate {
  source1_entity_id: string;
  source1_business_name: string;
  candidate_entity_id: string;
  candidate_business_name: string;
  candidate_address: string;
  candidate_country: string;
  candidate_source: string;
  score: number | string;
  is_match: boolean | string;
  rank?: number;
}

export interface Pagination {
  total: number;
  page: number;
  page_size: number;
}

export interface PageResult<T> extends Pagination {
  items: T[];
}

export interface ValidationCheck {
  name: string;
  valid: boolean;
  rows?: number | null;
  errors?: string[];
}

export interface Validation {
  run_id: string;
  status: 'VALID' | 'FAILED';
  checks: ValidationCheck[];
  errors: string[];
  f05?: number;
  precision?: number;
  recall?: number;
  coverage?: number;
  rows_validated?: number;
  warnings?: string[];
}

export type ValidationResult = Validation;

export interface APIError {
  status: number;
  message: string;
  detail?: string | unknown;
}

export interface SearchItem {
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
}

export interface SearchEntity extends SearchItem {
  status?: string;
  match_status?: string;
  confidence?: number | null;
}

export interface SearchCandidate extends SearchItem {
  s1_id?: string;
  score?: number | null;
  source?: string;
}

export interface SearchRun extends SearchItem {
  status?: string;
}

export interface SearchDataset extends SearchItem {
  valid: boolean;
}

export interface SearchResponse {
  query: string;
  entities: SearchEntity[];
  candidates: SearchCandidate[];
  runs: SearchRun[];
  datasets: SearchDataset[];
  total_matches: number;
}
