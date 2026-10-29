export interface RoutePerformanceBudget {
  route: string;
  maxStartupRequests: number;
  maxPayloadKb: number;
  maxServerTimingMs: number;
  maxDatabaseTimingMs: number;
  maxFirstLoadJsKb: number;
}

export const PERFORMANCE_BUDGETS: Record<string, RoutePerformanceBudget> = {
  companies: {
    route: '/companies',
    maxStartupRequests: 4,
    maxPayloadKb: 180,
    maxServerTimingMs: 700,
    maxDatabaseTimingMs: 450,
    maxFirstLoadJsKb: 220,
  },
  processing: {
    route: '/processing',
    maxStartupRequests: 5,
    maxPayloadKb: 240,
    maxServerTimingMs: 900,
    maxDatabaseTimingMs: 650,
    maxFirstLoadJsKb: 260,
  },
  publicForm: {
    route: '/forms/f/[slug]',
    maxStartupRequests: 3,
    maxPayloadKb: 180,
    maxServerTimingMs: 600,
    maxDatabaseTimingMs: 350,
    maxFirstLoadJsKb: 220,
  },
  publicSigning: {
    route: '/esigning/sign/[token]',
    maxStartupRequests: 4,
    maxPayloadKb: 220,
    maxServerTimingMs: 750,
    maxDatabaseTimingMs: 450,
    maxFirstLoadJsKb: 220,
  },
};

export const REQUIRED_PERFORMANCE_DIMENSIONS: Array<keyof RoutePerformanceBudget> = [
  'maxStartupRequests',
  'maxPayloadKb',
  'maxServerTimingMs',
  'maxDatabaseTimingMs',
  'maxFirstLoadJsKb',
];
