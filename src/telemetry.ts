// Loaded via: node --import ./dist/telemetry.js dist/index.js
// The --import flag guarantees this runs before any other ES module, which is
// required for the OTEL SDK to patch Node.js core APIs (http, net, etc.).
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { trace, metrics, context } from '@opentelemetry/api';

const enabled = process.env['OTEL_ENABLED'] === 'true';

if (enabled) {
  // OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME are read natively by the SDK
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  // Graceful degradation: a bad endpoint or init error must never crash the server
  try {
    sdk.start();
    process.on('SIGTERM', () => { sdk.shutdown().catch(() => {}); });
  } catch (e) {
    console.warn('[otel] SDK start failed, continuing without telemetry:', e);
  }
}

export const tracer = trace.getTracer('coding-agent-a2a');

// Meter instruments created once at module level so they are reused across events
const meter = metrics.getMeter('coding-agent-a2a');
export const inputTokenCounter  = meter.createCounter('agent.tokens.input',      { description: 'LLM input tokens consumed' });
export const outputTokenCounter = meter.createCounter('agent.tokens.output',     { description: 'LLM output tokens generated' });
export const taskDurationHist   = meter.createHistogram('agent.task.duration_ms', { description: 'End-to-end CLI task duration in milliseconds', unit: 'ms' });
export const taskErrorCounter   = meter.createCounter('agent.task.errors',        { description: 'Task error count by adapter and error kind' });

export { context };
