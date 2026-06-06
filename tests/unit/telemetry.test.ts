import { describe, it, expect, vi, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sdkStart: vi.fn(),
  sdkShutdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn(() => ({ start: mocks.sdkStart, shutdown: mocks.sdkShutdown })),
}));
vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: vi.fn().mockReturnValue([]),
}));
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn(),
}));
vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: vi.fn(),
}));
vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: vi.fn(),
}));

afterEach(() => {
  delete process.env['OTEL_ENABLED'];
  vi.resetModules();
  mocks.sdkStart.mockClear();
  mocks.sdkShutdown.mockClear();
});

describe('telemetry', () => {
  it('exports tracer and meter instruments regardless of OTEL_ENABLED', async () => {
    const { tracer, inputTokenCounter, outputTokenCounter, taskDurationHist, taskErrorCounter } =
      await import('../../src/telemetry.js');
    expect(tracer).toBeDefined();
    expect(inputTokenCounter).toBeDefined();
    expect(outputTokenCounter).toBeDefined();
    expect(taskDurationHist).toBeDefined();
    expect(taskErrorCounter).toBeDefined();
    expect(mocks.sdkStart).not.toHaveBeenCalled();
  });

  it('starts OTEL SDK when OTEL_ENABLED=true', async () => {
    process.env['OTEL_ENABLED'] = 'true';
    vi.resetModules();
    await import('../../src/telemetry.js');
    expect(mocks.sdkStart).toHaveBeenCalledTimes(1);
  });

  it('logs a warning and continues when SDK start() throws', async () => {
    process.env['OTEL_ENABLED'] = 'true';
    mocks.sdkStart.mockImplementationOnce(() => { throw new Error('collector unreachable'); });
    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../../src/telemetry.js');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[otel]'),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
