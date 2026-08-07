export type DependencyProbe = {
  name: string;
  check(): Promise<void>;
};

export type ReadinessResult = {
  status: 'ok' | 'unavailable';
  dependencies: Record<string, 'up' | 'down'>;
};

export class HealthService {
  constructor(private readonly probes: readonly DependencyProbe[]) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<ReadinessResult> {
    const entries = await Promise.all(
      this.probes.map(async (probe) => {
        try {
          await probe.check();
          return [probe.name, 'up'] as const;
        } catch {
          return [probe.name, 'down'] as const;
        }
      }),
    );
    const dependencies = Object.fromEntries(entries);
    return {
      status: Object.values(dependencies).every((value) => value === 'up') ? 'ok' : 'unavailable',
      dependencies,
    };
  }
}
