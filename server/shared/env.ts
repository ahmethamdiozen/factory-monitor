import { existsSync } from 'node:fs'

if (existsSync('.env')) process.loadEnvFile('.env')

export const env = {
  mssql: {
    host: process.env.MSSQL_HOST ?? 'localhost',
    port: Number(process.env.MSSQL_PORT ?? 1433),
    user: process.env.MSSQL_USER ?? 'sa',
    password: process.env.MSSQL_SA_PASSWORD ?? 'Factory!Monitor2026',
    database: process.env.MSSQL_DB ?? 'FactoryDB',
  },
  sqlitePath: process.env.SQLITE_PATH ?? 'data/factory.db',
  apiPort: Number(process.env.API_PORT ?? 3001),
}

export const log = (scope: string, ...args: unknown[]) =>
  console.log(`${new Date().toLocaleTimeString('tr-TR')} [${scope}]`, ...args)
