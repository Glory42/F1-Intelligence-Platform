import type { Circuit } from './circuits';
import type { Driver } from './drivers';
import type { Team } from './teams';

// GET /api/search builds this shape inline in the API, so it has no named contract type to re-export.
export type GlobalSearchResponse = { drivers: Driver[]; teams: Team[]; circuits: Circuit[] };
