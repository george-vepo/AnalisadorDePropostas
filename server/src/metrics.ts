export type MetricsSnapshot = {
  totalRequests: number;
  totalErrors: number;
  analyzeRequests: number;
  lastErrorAt?: string;
};

const metrics: MetricsSnapshot = {
  totalRequests: 0,
  totalErrors: 0,
  analyzeRequests: 0,
};

export const incrementRequest = (path?: string) => {
  metrics.totalRequests += 1;
  if (path?.startsWith('/api/analyze')) {
    metrics.analyzeRequests += 1;
  }
};

export const incrementError = () => {
  metrics.totalErrors += 1;
  metrics.lastErrorAt = new Date().toISOString();
};

export const getMetrics = (): MetricsSnapshot => ({ ...metrics });
