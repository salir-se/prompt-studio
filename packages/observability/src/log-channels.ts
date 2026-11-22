/**
 * Three-channel logging architecture.
 *
 * 1. Debug logger    — browser console, developer tool, verbose, dev-only
 * 2. Observe logger  — structured observability/tracing, health monitoring
 * 3. Public logger   — UI-visible logs (RBAC-filtered subset), space-limited
 *                      Public logs are automatically forwarded to observe sinks
 *                      (public is a subset of observe — all public logs are monitored).
 *
 * All channels apply sensitive data masking before output.
 *
 * Usage:
 *   const log = createChannelLogger('agent');
 *   log.debug.info({ iteration: 5 }, 'processing tools');     // → console only
 *   log.observe.info({ tokens: 1200 }, 'agent iteration');     // → observability sink
 *   log.public.info({ status: 'running' }, 'Agent started');   // → UI log panel + observability
 */

import { maskSensitiveData } from './masking';
import type { Logger } from './types';

// ── Log entry type ───────────────────────────────────────────────────────

export interface LogEntry {
  timestamp: string;
  channel: 'debug' | 'observe' | 'public';
  level: 'debug' | 'info' | 'warn' | 'error';
  namespace: string;
  message: string;
  data?: Record<string, unknown>;
}

// ── Log sink interface ───────────────────────────────────────────────────

/** Where log entries are sent. Implement to add custom destinations. */
export interface LogSink {
  write(entry: LogEntry): void;
}

/** Console sink — writes to browser console with namespace prefix. */
export class ConsoleSink implements LogSink {
  write(entry: LogEntry): void {
    const prefix = `[${entry.namespace}]`;
    const method =
      entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : entry.level === 'debug' ? 'debug' : 'info';
    if (entry.data && Object.keys(entry.data).length > 0) {
      console[method](prefix, entry.message, entry.data);
    } else {
      console[method](prefix, entry.message);
    }
  }
}

/** In-memory ring buffer sink — stores last N entries for UI display. */
export class RingBufferSink implements LogSink {
  private buffer: LogEntry[] = [];
  private readonly maxSize: number;
  private listeners = new Set<(entry: LogEntry) => void>();

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  write(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  /** Get all stored entries. */
  getEntries(): readonly LogEntry[] {
    return this.buffer;
  }

  /** Get entries filtered by level. */
  getEntriesByLevel(level: LogEntry['level']): LogEntry[] {
    return this.buffer.filter((e) => e.level === level);
  }

  /** Subscribe to new entries. Returns unsubscribe function. */
  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Clear the buffer. */
  clear(): void {
    this.buffer = [];
  }

  /** Current entry count. */
  get size(): number {
    return this.buffer.length;
  }
}

// ── Channel logger factory ───────────────────────────────────────────────

/** Sinks configuration for the three channels. */
export interface ChannelSinks {
  /** Debug channel sinks (default: ConsoleSink). */
  debug?: LogSink[];
  /** Observability channel sinks (default: none — add server transport). */
  observe?: LogSink[];
  /** Public channel sinks (default: RingBufferSink for UI). */
  public?: LogSink[];
}

/** A logger that writes to all three channels. */
export interface ChannelLogger {
  /** Debug logger — verbose, console-only, dev tool. */
  debug: Logger;
  /** Observability logger — structured, health monitoring. */
  observe: Logger;
  /** Public logger — UI-visible, RBAC-filtered subset. */
  public: Logger;
}

// Default sinks (module-level, shared across all channel loggers)
let defaultSinks: ChannelSinks = {};

/** Set the default sinks for all channel loggers. Call once at app startup. */
export function configureChannelSinks(sinks: ChannelSinks): void {
  defaultSinks = sinks;
}

/** Get the configured sinks (for testing/inspection). */
export function getChannelSinks(): ChannelSinks {
  return defaultSinks;
}

/**
 * Create a channel logger with all three channels.
 *
 * @param namespace - Logger namespace (e.g., 'agent', 'storage', 'critic')
 * @param sinks - Optional per-instance sink overrides
 */
export function createChannelLogger(namespace: string, sinks?: ChannelSinks): ChannelLogger {
  const debugSinks = sinks?.debug ?? defaultSinks.debug ?? [new ConsoleSink()];
  const observeSinks = sinks?.observe ?? defaultSinks.observe ?? [];
  const publicOnlySinks = sinks?.public ?? defaultSinks.public ?? [];

  // Visibility hierarchy (higher channels cascade down):
  //   public  → public sinks + observe sinks + debug sinks
  //   observe → observe sinks + debug sinks
  //   debug   → debug sinks only
  const resolvedSinks = {
    debug: debugSinks,
    observe: [...observeSinks, ...debugSinks],
    public: [...publicOnlySinks, ...observeSinks, ...debugSinks],
  };

  function createChannelWriter(channel: LogEntry['channel'], channelSinks: LogSink[]): Logger {
    function emit(level: LogEntry['level'], objOrMsg: Record<string, unknown> | string, msg?: string): void {
      const isObj = typeof objOrMsg === 'object';
      const rawData = isObj ? objOrMsg : undefined;
      const message = isObj ? (msg ?? '') : objOrMsg;

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        channel,
        level,
        namespace,
        message,
        data: rawData ? maskSensitiveData(rawData) : undefined,
      };

      for (const sink of channelSinks) {
        sink.write(entry);
      }
    }

    function logMethod(level: LogEntry['level']) {
      return (objOrMsg: Record<string, unknown> | string, msg?: string) => emit(level, objOrMsg, msg);
    }

    return {
      debug: logMethod('debug'),
      info: logMethod('info'),
      warn: logMethod('warn'),
      error: logMethod('error'),
      child(bindings: Record<string, unknown>): Logger {
        const _childNs = bindings.name ? `${namespace}:${String(bindings.name)}` : namespace;
        return createChannelWriter(channel, channelSinks);
      },
    } as Logger;
  }

  return {
    debug: createChannelWriter('debug', resolvedSinks.debug),
    observe: createChannelWriter('observe', resolvedSinks.observe),
    public: createChannelWriter('public', resolvedSinks.public),
  };
}
