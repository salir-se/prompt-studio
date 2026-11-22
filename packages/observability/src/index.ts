// @prompt-studio/observability -- structured logging, data masking, OTel stubs

// ── Process-level audit-log sink registry (persisted audit events → pino) ──
export type { AuditLogRecord, AuditLogStore, AuditSinkLogger } from './audit-log';
export { __resetAuditLogSinkForTests, AUDIT_LOG_MESSAGE, emitAuditLogEvent, setAuditLogSink } from './audit-log';
// ── Scoped child logger with projected bindings (ADR-114 layered model) ──
export type { ChildableLogger } from './child-logger';
export { childLogger } from './child-logger';
// ── Duck-typed { code, correlationId, status } extraction from unknown errors ──
export type { ErrorFields } from './error-fields';
export { resolveErrorFields } from './error-fields';
// ── Upstream error text → one bounded, markup-free display line ───────
export type { DisplayErrorTextOptions } from './error-text';
export {
  containsMarkup,
  extractCloudflareRayId,
  extractHtmlErrorText,
  isHtmlMediaType,
  MAX_DISPLAY_ERROR_CHARS,
  MAX_HTML_ERROR_TEXT_CHARS,
  stripMarkup,
  toDisplayErrorText,
} from './error-text';
// ── Global window error + unhandled-rejection capture ────────────────
export { __resetGlobalErrorCaptureForTest, installGlobalErrorCapture, serializeReason } from './global-error-capture';
// ── Best-effort audit-write failure logging ───────────────────────────
export type { WarnLogger } from './log-audit-failure';
export { AUDIT_FAILURE_MESSAGE, logAuditFailure } from './log-audit-failure';
// ── Three-channel logging architecture ────────────────────────────────
export type { ChannelLogger, ChannelSinks, LogEntry, LogSink } from './log-channels';
export {
  ConsoleSink,
  configureChannelSinks,
  createChannelLogger,
  getChannelSinks,
  RingBufferSink,
} from './log-channels';
// ── Arktype-projected, resilient log context (cast ctx → declared fields) ──
export type { LogFieldsDef, LogProjector } from './log-fields';
export { logFields } from './log-fields';
// ── Sensitive data masking ────────────────────────────────────────────
export { addSensitiveKeys, isSensitiveKey, maskSecretValue, maskSensitiveData } from './masking';
// ── Metrics stubs (future OTel) ───────────────────────────────────────
export type { Counter, Histogram, Meter } from './metrics';
export { createMeter } from './metrics';
// ── OTLP log-record model, dataset naming, batching fail-open shipper ─
export type {
  AxiomConsoleEnvironment,
  LogShipper,
  LogShipperConfig,
  NormalizeOptions,
  OtelAttributeValue,
  OtelKeyValue,
  OtelLogRecord,
  OtelResource,
  OtelSpan,
  PinoBrowserLogEvent,
  SpanShipper,
  SpanShipperConfig,
  TraceContext,
} from './otel';
export {
  AXIOM_API_BASE_URL,
  AXIOM_DASHBOARD_UID,
  AXIOM_INGEST_BASE_URL,
  AXIOM_ORG_ID,
  axiomDashboardUrl,
  axiomDatasetForEnvironment,
  axiomMonitorsUrl,
  axiomTracesDatasetForEnvironment,
  boundLogAttributes,
  boundOtelAttributes,
  buildExportPayload,
  buildResource,
  buildSpan,
  buildTraceExportPayload,
  buildTraceparent,
  createLogShipper,
  createSpanShipper,
  generateSpanId,
  generateTraceId,
  INDEXED_LOG_ATTRIBUTE_KEYS,
  MAX_ATTR_VALUE_CHARS,
  MAX_RECORD_BODY_CHARS,
  normalizeLogRecords,
  parseTraceparent,
  SPAN_KIND,
  SPAN_STATUS,
  TRACEPARENT_HEADER,
  toOtelAttributes,
  toOtelLogRecord,
  traceIdFromCorrelationId,
} from './otel';
// ── Pino logger (concrete implementation, backward compat) ────────────
export type { LoggerContext } from './pino-logger';
export {
  clearBrowserLogTransmit,
  clearLoggerContext,
  configureBrowserLogTransmit,
  createLogger,
  errSerializer,
  getLoggerContext,
  getLogLevel,
  replaceLoggerContext,
  rootLogger,
  setLoggerContext,
  setLogLevel,
} from './pino-logger';
// ── Policy decision recorder (ADR-079) ────────────────────────────────
export type {
  CreatePolicyRecorderOptions,
  PolicyDecisionShape,
  PolicyEventEmitter,
  PolicyReasoning,
  PolicyRecorder,
  RecordPolicyArgs,
} from './policy-recorder';
export { createPolicyRecorder } from './policy-recorder';
export type {
  ListDecisionsFilter,
  PolicyDecisionStore,
  PolicyEventSubscriber,
  PolicyStoreSubscriber,
  PolicyStoreSubscriberOptions,
} from './policy-store';
export {
  applyListDecisionsFilter,
  createInMemoryPolicyDecisionStore,
  subscribePolicyDecisionsToStore,
} from './policy-store';
// ── IndexedDB-backed policy decision persistence (ADR-079, issue #179) ─
export type { IndexedDBPolicyDecisionStoreOptions } from './policy-store-indexeddb';
export {
  createIndexedDBPolicyDecisionStore,
  createPersistentPolicyDecisionStore,
  supportsIndexedDB,
} from './policy-store-indexeddb';
// ── Cross-tab broadcast for the IndexedDB policy decision store ────────
export type { PolicyDecisionsBroadcast, PolicyDecisionsBroadcastMessage } from './policy-store-indexeddb-broadcast';
export { createPolicyDecisionsBroadcast, POLICY_DECISIONS_BROADCAST_CHANNEL } from './policy-store-indexeddb-broadcast';
// ── Policy decision types (canonical home; re-exported by @prompt-studio/types) ─
export type {
  PolicyDecision,
  PolicyEntityKind,
  PolicyEntityRef,
  PolicyId,
  PolicyOutcome,
  PolicyRegistryEntry,
} from './policy-types';
export {
  POLICY_DECISIONS_COLLECTION,
  POLICY_DECISIONS_DEFAULT_RETENTION_DAYS,
  POLICY_REGISTRY,
  POLICY_VERSION_DEFAULT,
} from './policy-types';
// ── Pino native redaction config (path-based secret backstop) ──────────
export { redactCensor, WORKER_REDACT_PATHS, workerRedact } from './redaction';
// ── Shared libSQL client instrumentation seam (Proxy + reporter port) ──
export type {
  InstrumentSqlClientOptions,
  SqlDebugLogger,
  SqlQueryReporter,
  SqlQuerySample,
} from './sql-instrumentation';
export { instrumentSqlClient } from './sql-instrumentation';
// ── SQL statement log helpers (shared by storage + BFF instrumentation) ──
export { argCount, normalizeSqlText, sqlTarget } from './sql-log';
// ── Bounded-timeout, opt-in-retry libSQL client wrapper (issue #1342) ──
export type { SqlDegradationEvent, SqlResilienceOptions, WithRetryableReadOptions } from './sql-resilience';
export {
  isRetryableSqlError,
  isSqlTimeoutError,
  resilientSqlClient,
  SqlTimeoutError,
  withRetryableRead,
} from './sql-resilience';
// ── Tracing stubs (future OTel) ───────────────────────────────────────
export type { Span, Tracer } from './tracing';
export { createTracer } from './tracing';
// ── Abstract logger contracts ─────────────────────────────────────────
export type { Logger, LoggerFactory } from './types';
