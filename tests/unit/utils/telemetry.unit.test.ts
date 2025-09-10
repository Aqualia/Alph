import { telemetry, Telemetry } from '../../../src/utils/telemetry';

describe('telemetry', () => {
  test('disabled by default', () => {
    expect(telemetry.isEnabled()).toBe(false);
    telemetry.recordConfigure(1, 0, 10);
    expect(telemetry.__getBuffer().length).toBe(0);
  });

  test('records only counts and durations (no PII)', () => {
    const t = new Telemetry(true);
    t.recordConfigure(2, 1, 1234);
    const buf = t.__getBuffer();
    expect(buf.length).toBe(1);
    const evt = buf[0];
    expect(evt.kind).toBe('configure');
    expect(typeof evt.success).toBe('number');
    expect(typeof evt.failure).toBe('number');
    expect(typeof evt.durationMs).toBe('number');
    // Ensure only 'kind' is a string; others are numeric
    const stringKeys = Object.keys(evt).filter(k => typeof (evt as any)[k] === 'string');
    expect(stringKeys).toEqual(['kind']);
  });
});
