/**
 * Abstract logger contracts -- consumers depend on these interfaces, not the pino implementation.
 *
 * Compatible with pino's method signatures. Any structured logger that implements
 * these methods can be used as a drop-in replacement.
 */

/** Structured logger instance. */
export interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** Factory that creates named logger instances. */
export type LoggerFactory = (name: string) => Logger;
