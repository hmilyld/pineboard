export type TraceMeta = {
  changes?: number;
  duration?: number;
  rows_read?: number;
  rows_written?: number;
  last_row_id?: number;
};

export type TraceEntry = {
  seq: number;
  kind: "prepare" | "bind" | "run" | "all" | "first" | "raw" | "batch" | "exec" | "error";
  sql?: string;
  meta?: TraceMeta;
  rows?: number;
  message?: string;
  at: number;
};

let seq = 0;
let entries: TraceEntry[] = [];
const statementSql = new WeakMap<object, string>();

export function resetTrace(): void {
  seq = 0;
  entries = [];
}

export function traceEntries(): TraceEntry[] {
  return entries;
}

export function traceCount(): number {
  return entries.length;
}

function push(entry: Omit<TraceEntry, "seq" | "at">): void {
  entries.push({ ...entry, seq: ++seq, at: Date.now() });
}

function metaOf(result: unknown): TraceMeta | undefined {
  if (!result || typeof result !== "object") return undefined;
  const meta = (result as { meta?: TraceMeta }).meta;
  if (!meta) return undefined;
  return {
    changes: meta.changes,
    duration: meta.duration,
    rows_read: meta.rows_read,
    rows_written: meta.rows_written,
    last_row_id: meta.last_row_id,
  };
}

function isSqlTx(sql: string): boolean {
  return /^\s*(begin|commit|rollback|savepoint|release)\b/i.test(sql);
}

export function wrapStatement(stmt: D1PreparedStatement, sql: string): D1PreparedStatement {
  statementSql.set(stmt, sql);
  const wrapped = new Proxy(stmt, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      if (prop === "bind") {
        return (...args: unknown[]) => {
          push({ kind: "bind", sql, rows: args.length });
          const bound = target.bind(...(args as never[]));
          return wrapStatement(bound, sql);
        };
      }

      if (prop === "run" || prop === "all" || prop === "first" || prop === "raw") {
        return async (...args: unknown[]) => {
          try {
            const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            const meta = metaOf(result);
            const rows = Array.isArray((result as { results?: unknown[] })?.results)
              ? (result as { results: unknown[] }).results.length
              : undefined;
            push({ kind: prop as "run" | "all" | "first" | "raw", sql, meta, rows });
            return result;
          } catch (error) {
            push({
              kind: "error",
              sql,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        };
      }

      return value.bind(target);
    },
  });
  return wrapped;
}

/**
 * Proxies the D1 binding so every statement can be inspected after a spike
 * request. This is intentionally spike-only: never ship it in production.
 */
export function instrumentD1(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      if (prop === "prepare") {
        return (sql: string) => {
          push({ kind: "prepare", sql });
          return wrapStatement(target.prepare(sql), sql);
        };
      }

      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          push({
            kind: "batch",
            rows: statements.length,
            sql: statements.map((s) => statementSql.get(s) ?? "<unknown>").join(";\n"),
          });
          const result = await target.batch(statements);
          for (const item of result) {
            push({ kind: "run", meta: metaOf(item) });
          }
          return result;
        };
      }

      if (prop === "exec") {
        return async (sql: string) => {
          push({ kind: "exec", sql });
          try {
            return await target.exec(sql);
          } catch (error) {
            push({
              kind: "error",
              sql,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        };
      }

      return value.bind(target);
    },
  });
}

export function traceSummary() {
  const sqlEntries = entries.filter((e) => e.kind === "prepare" || e.kind === "batch" || e.kind === "exec");
  const runEntries = entries.filter((e) => e.kind === "run" || e.kind === "all" || e.kind === "first" || e.kind === "raw");
  const txStatements = sqlEntries.filter((e) => e.sql && isSqlTx(e.sql));
  const errors = entries.filter((e) => e.kind === "error");
  return {
    statements: sqlEntries.length,
    executions: runEntries.length,
    rowsRead: runEntries.reduce((n, e) => n + (e.meta?.rows_read ?? 0), 0),
    rowsWritten: runEntries.reduce((n, e) => n + (e.meta?.rows_written ?? 0), 0),
    changes: runEntries.reduce((n, e) => n + (e.meta?.changes ?? 0), 0),
    transactionStatements: txStatements.map((e) => e.sql),
    hasInteractiveTransaction: txStatements.length > 0,
    errors: errors.map((e) => e.message),
    statementsSeen: sqlEntries.map((e) => e.sql).filter(Boolean),
    entries,
  };
}
