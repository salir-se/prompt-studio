// @prompt-studio/observability/otel -- OTLP/JSON log-record model, dataset naming, and
// the batching fail-open shipper. Shared contract module for worker, SPA,
// BFF-relay, and CLI Axiom log-shipping tasks.

export type { AxiomConsoleEnvironment } from './axiom-console';
export { AXIOM_DASHBOARD_UID, AXIOM_ORG_ID, axiomDashboardUrl, axiomMonitorsUrl } from './axiom-console';
export { boundLogAttributes, boundOtelAttributes, INDEXED_LOG_ATTRIBUTE_KEYS } from './bound-attributes';
export {
  AXIOM_API_BASE_URL,
  AXIOM_INGEST_BASE_URL,
  axiomDatasetForEnvironment,
  axiomTracesDatasetForEnvironment,
} from './dataset';
export type { OtelAttributeValue, OtelKeyValue, OtelLogRecord, OtelResource, PinoBrowserLogEvent } from './log-record';
export { buildExportPayload, buildResource, toOtelAttributes, toOtelLogRecord } from './log-record';
export type { NormalizeOptions } from './normalize';
export { MAX_ATTR_VALUE_CHARS, MAX_RECORD_BODY_CHARS, normalizeLogRecords } from './normalize';
export type { LogShipper, LogShipperConfig } from './shipper';
export { createLogShipper } from './shipper';
export type { OtelSpan, SpanShipper, SpanShipperConfig } from './span';
export { buildSpan, buildTraceExportPayload, createSpanShipper, SPAN_KIND, SPAN_STATUS } from './span';
export type { TraceContext } from './trace-context';
export {
  buildTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
  TRACEPARENT_HEADER,
  traceIdFromCorrelationId,
} from './trace-context';
