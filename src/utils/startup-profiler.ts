type StartupProfileStats = {
  count: number;
  totalMs: number;
  maxMs: number;
};

const stats = new Map<string, StartupProfileStats>();

let enabled = false;

export function enableStartupProfiler(): void {
  enabled = true;
}

export function disableStartupProfiler(): void {
  enabled = false;
}

export function resetStartupProfiler(): void {
  stats.clear();
}

export function profileStartupSync<T>(label: string, fn: () => T): T {
  if (!enabled) return fn();

  const start = performance.now();
  try {
    return fn();
  } finally {
    recordStartupProfile(label, performance.now() - start);
  }
}

function recordStartupProfile(label: string, durationMs: number): void {
  const current = stats.get(label) || {
    count: 0,
    totalMs: 0,
    maxMs: 0,
  };

  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);

  stats.set(label, current);
}

export function getStartupProfilerRows(): Array<{
  label: string;
  count: number;
  totalMs: number;
  averageMs: number;
  maxMs: number;
}> {
  return [...stats.entries()]
    .map(([label, value]) => ({
      label,
      count: value.count,
      totalMs: value.totalMs,
      averageMs: value.totalMs / value.count,
      maxMs: value.maxMs,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}
