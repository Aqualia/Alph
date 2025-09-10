interface ConfigureEvent {
  kind: 'configure';
  success: number;
  failure: number;
  durationMs: number;
}

type AnyEvent = ConfigureEvent;

export class Telemetry {
  private enabled: boolean;
  private buffer: AnyEvent[] = [];

  constructor(enabledFromEnv: boolean = (process?.env?.['ALPH_TELEMETRY'] === '1')) {
    // Opt-in via env only; default OFF
    this.enabled = enabledFromEnv;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  recordConfigure(success: number, failure: number, durationMs: number): void {
    if (!this.enabled) return;
    // Only counts and durations; no string payloads
    this.buffer.push({ kind: 'configure', success, failure, durationMs });
  }

  // Exposed for tests
  __getBuffer(): AnyEvent[] {
    return [...this.buffer];
  }
}

export const telemetry = new Telemetry();
