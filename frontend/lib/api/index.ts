export * from './client';
export * from './health';
export * from './uploads';
export * from './runs';
export * from './results';
export * from './candidates';
export * from './validation';
export * from './search';

import { healthApi } from './health';
import { uploadsApi } from './uploads';
import { runsApi } from './runs';
import { resultsApi } from './results';
import { candidatesApi } from './candidates';
import { validationApi } from './validation';
import { searchApi } from './search';
import type { Source } from '@/lib/types';

export const api = {
  health: healthApi.check,
  datasets: uploadsApi.list,
  upload: (source: Source, file: File) => uploadsApi.upload(source, file),
  deleteDataset: uploadsApi.delete,
  inputValidation: uploadsApi.validateInputs,
  runs: runsApi.list,
  run: runsApi.get,
  startRun: runsApi.start,
  results: resultsApi.list,
  result: resultsApi.get,
  candidates: candidatesApi.list,
  candidatesFor: candidatesApi.forEntity,
  validation: validationApi.validateRun,
  search: searchApi.search,
  downloadUrl: runsApi.downloadUrl,
};

export default api;
