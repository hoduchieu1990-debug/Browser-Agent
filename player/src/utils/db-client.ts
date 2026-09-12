import * as sql from 'mssql';
import type { DbConnectionConfig, DbParamValue } from '@browser-agent/shared';

// A pool per call, not the driver's global sql.connect() — two dbQuery steps
// in the same workflow can point at different servers, and a shared global
// pool would silently reuse whichever config connected first.
async function withPool<T>(conn: DbConnectionConfig, fn: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
  const pool = new sql.ConnectionPool({
    server: conn.server,
    database: conn.database,
    user: conn.user,
    password: conn.password,
    port: conn.port,
    options: {
      encrypt: conn.encrypt ?? true,
      trustServerCertificate: conn.trustServerCertificate ?? false,
    },
  });

  await pool.connect();
  try {
    return await fn(pool);
  } finally {
    await pool.close();
  }
}

// SQL Server has no positional "?" placeholder like MySQL — params bind to
// named @p0, @p1, ... markers, so the query/statement text must reference
// them that way (e.g. "SELECT * FROM t WHERE id = @p0").
function bindParams(request: sql.Request, params?: DbParamValue[]): void {
  params?.forEach((value, i) => request.input(`p${i}`, value));
}

export async function runQuery(
  conn: DbConnectionConfig,
  query: string,
  params?: DbParamValue[],
): Promise<Record<string, unknown>[]> {
  return withPool(conn, async (pool) => {
    const request = pool.request();
    bindParams(request, params);
    const result = await request.query(query);
    return result.recordset ?? [];
  });
}

export async function runStatement(
  conn: DbConnectionConfig,
  statement: string,
  params?: DbParamValue[],
): Promise<number> {
  return withPool(conn, async (pool) => {
    const request = pool.request();
    bindParams(request, params);
    const result = await request.query(statement);
    return result.rowsAffected.reduce((a, b) => a + b, 0);
  });
}
