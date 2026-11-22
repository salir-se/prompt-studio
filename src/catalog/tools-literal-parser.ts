/**
 * Conservative literal parser for `*_TOOLS` array constants (ADR-235, task #12; the direction
 * ADR-204 §7 gap 1 prescribed).
 *
 * The container build cannot statically import the tool arrays (that would bake their
 * descriptions — prose — into the image), and `extractConstant` deliberately refuses anything
 * that is not a single string/template literal, so the Tools panel renders empty in the container
 * today. This parser reads the ALREADY-FETCHED module text and extracts an
 * `export const <SYMBOL> = [ ... ]` array of PLAIN LITERALS ONLY — strings, template literals
 * WITHOUT interpolations, numbers, booleans, arrays, and objects of those. Anything else — an
 * identifier, a function call, a spread, a `${...}` interpolation — refuses the WHOLE array
 * (`null`), never a partial guess: a wrong tool list is worse than an empty one (the same
 * "null over wrong" principle the rest of this app's extraction follows).
 */

const IDENT_START_RE = /[A-Za-z_$]/;
const IDENT_RE = /[A-Za-z0-9_$]/;

export interface ParsedToolDefinition {
  readonly name: string;
  /** Absent for description-less tools (e.g. `web_search`, which carries a `type` instead). */
  readonly description?: string;
  /** Sorted input-schema property names (empty when the tool declares no schema properties). */
  readonly inputKeys: readonly string[];
}

class Parser {
  private readonly source: string;
  private pos = 0;

  constructor(source: string) {
    this.source = source;
  }

  private fail(): never {
    throw new ParseRefusal(this.pos);
  }

  private skipTrivia(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === '/' && this.source[this.pos + 1] === '/') {
        this.pos += 2;
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') this.pos++;
      } else if (ch === '/' && this.source[this.pos + 1] === '*') {
        this.pos += 2;
        while (this.pos < this.source.length && !(this.source[this.pos] === '*' && this.source[this.pos + 1] === '/')) {
          this.pos++;
        }
        this.pos += 2;
      } else if (/\s/.test(ch)) {
        this.pos++;
      } else {
        return;
      }
    }
  }

  private peek(): string {
    this.skipTrivia();
    return this.source[this.pos] ?? '';
  }

  /** Positions the cursor (used to jump past the `=` the caller already located). */
  seekTo(pos: number): void {
    this.pos = pos;
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) this.fail();
    this.pos++;
  }

  /** A string/template literal WITHOUT `${...}` interpolations; returns the raw inner text. */
  private parseStringLiteral(): string {
    this.skipTrivia();
    const delimiter = this.source[this.pos];
    if (delimiter !== "'" && delimiter !== '"' && delimiter !== '`') this.fail();
    const start = ++this.pos;
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === '\\') {
        this.pos += 2;
        continue;
      }
      if (delimiter === '`' && ch === '$' && this.source[this.pos + 1] === '{') {
        this.fail(); // interpolation — refuse rather than guess the value
      }
      if (ch === delimiter) {
        this.pos++;
        return this.source.slice(start, this.pos - 1);
      }
      this.pos++;
    }
    this.fail();
  }

  /** A string literal, optionally `+`-concatenated with further string literals (a common
   *  multi-line description authoring pattern — still conservative: only string + string). */
  private parseConcatenatedString(): string {
    let value = this.parseStringLiteral();
    while (this.peek() === '+') {
      this.pos++;
      value += this.parseStringLiteral();
    }
    return value;
  }

  parseValue(): unknown {
    const ch = this.peek();
    if (ch === "'" || ch === '"' || ch === '`') return this.parseConcatenatedString();
    if (ch === '[') {
      this.pos++;
      const items: unknown[] = [];
      if (this.peek() === ']') {
        this.pos++;
        return items;
      }
      for (;;) {
        if (this.peek() === '.' && this.source[this.pos + 1] === '.') this.fail(); // spread
        items.push(this.parseValue());
        const next = this.peek();
        if (next === ',') {
          this.pos++;
          if (this.peek() === ']') {
            this.pos++;
            return items;
          }
          continue;
        }
        this.expect(']');
        return items;
      }
    }
    if (ch === '{') {
      this.pos++;
      const record: Record<string, unknown> = {};
      if (this.peek() === '}') {
        this.pos++;
        return record;
      }
      for (;;) {
        const key = this.peek();
        if (key === "'" || key === '"' || key === '`') {
          const name = this.parseStringLiteral();
          this.expect(':');
          record[name] = this.parseValue();
        } else if (IDENT_START_RE.test(key)) {
          let name = '';
          while (IDENT_RE.test(this.source[this.pos] ?? '')) name += this.source[this.pos++];
          this.skipTrivia();
          this.expect(':');
          record[name] = this.parseValue();
        } else {
          this.fail(); // computed/spread keys are not plain literals
        }
        const next = this.peek();
        if (next === ',') {
          this.pos++;
          if (this.peek() === '}') {
            this.pos++;
            return record;
          }
          continue;
        }
        this.expect('}');
        return record;
      }
    }
    if (/[0-9]/.test(ch) || ch === '-') {
      const start = this.pos;
      if (ch === '-') this.pos++;
      while (/[0-9.]/.test(this.source[this.pos] ?? '')) this.pos++;
      const text = this.source.slice(start, this.pos);
      const value = Number(text);
      if (!Number.isFinite(value)) this.fail();
      return value;
    }
    if (this.source.startsWith('true', this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.source.startsWith('false', this.pos)) {
      this.pos += 5;
      return false;
    }
    // Anything else (identifier, call, arrow) is not a literal — refuse the whole array.
    this.fail();
  }
}

class ParseRefusal extends Error {
  constructor(readonly position: number) {
    super(`refused at ${position}`);
  }
}

/** Debug companion to `parseExportedToolArray`: throws the refusal WITH its source position. */
export function parseExportedToolArrayOrThrow(source: string, symbol: string): readonly ParsedToolDefinition[] {
  const declarationRe = new RegExp(`export\\s+const\\s+${escapeRegExp(symbol)}\\b`);
  const match = declarationRe.exec(source);
  if (!match) throw new Error('declaration not found');
  const eq = source.indexOf('=', match.index + match[0].length);
  if (eq === -1) throw new Error('no =');
  const parser = new Parser(source);
  parser.seekTo(eq + 1);
  const value = parser.parseValue();
  if (!Array.isArray(value)) throw new Error('not an array');
  // Any member that is not a valid tool definition refuses the WHOLE array — same
  // null-over-wrong contract as the parser itself (see parseExportedToolArray below).
  const tools: ParsedToolDefinition[] = [];
  for (const member of value) {
    const tool = toToolDefinition(member);
    if (tool === null) throw new Error(`member is not a valid tool definition`);
    tools.push(tool);
  }
  return tools;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Narrows one parsed array item to the ToolDefinition projection the Tools panel consumes. */
function toToolDefinition(value: unknown): ParsedToolDefinition | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string') return null;
  const tool: { name: string; description?: string; inputKeys: readonly string[] } = {
    name: record.name,
    inputKeys: [],
  };
  if (record.description !== undefined) {
    if (typeof record.description !== 'string') return null;
    tool.description = record.description;
  }
  const schema = record.input_schema;
  if (typeof schema === 'object' && schema !== null) {
    const properties = (schema as Record<string, unknown>).properties;
    if (typeof properties === 'object' && properties !== null) {
      tool.inputKeys = Object.keys(properties as Record<string, unknown>).sort();
    }
  }
  return tool;
}

/**
 * Parses `export const <symbol> = [ ...plain literals... ]` from raw TypeScript module text.
 * Returns `null` when the declaration is absent OR anything inside it is not a plain literal.
 */
export function parseExportedToolArray(source: string, symbol: string): readonly ParsedToolDefinition[] | null {
  const declarationRe = new RegExp(`export\\s+const\\s+${escapeRegExp(symbol)}\\b`);
  const match = declarationRe.exec(source);
  if (!match) return null;

  const eq = source.indexOf('=', match.index + match[0].length);
  if (eq === -1) return null;

  const parser = new Parser(source);
  parser.seekTo(eq + 1);
  let value: unknown;
  try {
    value = parser.parseValue();
  } catch (error) {
    if (error instanceof ParseRefusal) return null;
    throw error;
  }
  if (!Array.isArray(value)) return null;
  // A member that is a plain literal but not a valid tool definition (missing `name`, a mistyped
  // field) refuses the whole array too — never a partial list. A wrong tool list is worse than an
  // empty one, and a silently-shortened list is a wrong one.
  const tools: ParsedToolDefinition[] = [];
  for (const member of value) {
    const tool = toToolDefinition(member);
    if (tool === null) return null;
    tools.push(tool);
  }
  return tools;
}
