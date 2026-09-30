import sql from 'mssql'
import { readFileSync } from 'node:fs'
import { env } from './env'

export { sql }

function config(database: string): sql.config {
  return {
    server: env.mssql.host,
    port: env.mssql.port,
    user: env.mssql.user,
    password: env.mssql.password,
    database,
    options: { encrypt: false, trustServerCertificate: true, useUTC: true },
    pool: { max: 5 },
    requestTimeout: 60_000,
    connectionTimeout: 5_000,
  }
}

/** Veritabanı yoksa oluşturur (sadece simülatör — "fabrika" tarafı — çağırır). */
export async function ensureDatabase(): Promise<void> {
  const master = await new sql.ConnectionPool(config('master')).connect()
  try {
    await master.request().query(`IF DB_ID(N'${env.mssql.database}') IS NULL CREATE DATABASE [${env.mssql.database}]`)
  } finally {
    await master.close()
  }
}

export async function connect(): Promise<sql.ConnectionPool> {
  return new sql.ConnectionPool(config(env.mssql.database)).connect()
}

export async function runSqlFile(pool: sql.ConnectionPool, path: string): Promise<void> {
  const batches = readFileSync(path, 'utf8').split(/^\s*GO\s*$/m).map((b) => b.trim()).filter(Boolean)
  for (const b of batches) await pool.request().batch(b)
}

/** Bekleyip tekrar dener (SQL Server açılırken ilk bağlantılar reddedilebilir). */
export async function retry<T>(fn: () => Promise<T>, what: string, onWait: (msg: string) => void, tries = 60): Promise<T> {
  for (let k = 1; ; k++) {
    try {
      return await fn()
    } catch (e) {
      if (k >= tries) throw e
      onWait(`${what} bekleniyor (${(e as Error).message.split('\n')[0]}) — ${k}/${tries}`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}
