import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { env } from './env'

/** Collector'ın yerel deposu. Collector yazar, API okur (WAL modu ile eşzamanlı). */
export function openSqlite(): DatabaseSync {
  mkdirSync(dirname(env.sqlitePath), { recursive: true })
  // timeout: başka süreç (collector/API) kilitliyse beklesin, hemen hata vermesin
  const db = new DatabaseSync(env.sqlitePath, { timeout: 10_000 })
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    -- 10 sn'lik anlamlandırılmış dilimler
    CREATE TABLE IF NOT EXISTS bucket (
      machine_id  TEXT    NOT NULL,
      t           INTEGER NOT NULL,
      state       INTEGER NOT NULL,
      down_reason INTEGER NOT NULL,
      slow_reason INTEGER NOT NULL,
      speed       REAL    NOT NULL,
      ok          INTEGER NOT NULL,
      nok         INTEGER NOT NULL,
      temp        REAL    NOT NULL,
      vib         REAL    NOT NULL,
      feed        REAL    NOT NULL,
      PRIMARY KEY (machine_id, t)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS bucket_t ON bucket (t);

    CREATE TABLE IF NOT EXISTS stop_event (
      id          INTEGER PRIMARY KEY,
      machine_id  TEXT    NOT NULL,
      state       INTEGER NOT NULL,
      reason_id   INTEGER NOT NULL,
      start       INTEGER NOT NULL,
      end         INTEGER,
      updated_at  INTEGER NOT NULL,
      UNIQUE (machine_id, start)
    );
    CREATE INDEX IF NOT EXISTS stop_event_upd ON stop_event (updated_at);

    CREATE TABLE IF NOT EXISTS slow_event (
      id          INTEGER PRIMARY KEY,
      machine_id  TEXT    NOT NULL,
      reason_id   INTEGER NOT NULL,
      start       INTEGER NOT NULL,
      end         INTEGER,
      min_speed   REAL    NOT NULL,
      updated_at  INTEGER NOT NULL,
      UNIQUE (machine_id, start)
    );
    CREATE INDEX IF NOT EXISTS slow_event_upd ON slow_event (updated_at);

    CREATE TABLE IF NOT EXISTS spc_subgroup (
      machine_id TEXT    NOT NULL,
      t          INTEGER NOT NULL,
      mean       REAL    NOT NULL,
      range      REAL    NOT NULL,
      PRIMARY KEY (machine_id, t)
    ) WITHOUT ROWID;

    -- SQL Server'daki her tablo için en son okunan Id
    CREATE TABLE IF NOT EXISTS sync_state (
      tbl          TEXT PRIMARY KEY,
      last_id      INTEGER NOT NULL,
      last_sync_at INTEGER NOT NULL,
      rows_total   INTEGER NOT NULL
    );
  `)
  return db
}

export function kvGet<T>(db: DatabaseSync, k: string): T | null {
  const r = db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined
  return r ? (JSON.parse(r.v) as T) : null
}

export function kvSet(db: DatabaseSync, k: string, v: unknown): void {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v))
}

/** Collector'ın API'ye bıraktığı sağlık bilgisi */
export interface CollectorHealth {
  lastPollAt: number
  lastSuccessAt: number | null
  error: string | null
  /** Son turda okunan satır sayısı */
  lastRows: number
  rowsPerMin: number
}
