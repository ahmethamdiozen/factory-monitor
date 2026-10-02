import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { env } from './env'

/**
 * Yerel deponun yapı sürümü. Depo SQL Server'dan türetilmiş bir ön bellektir: yapı değişince
 * tablolar düşürülür ve collector her şeyi SQL Server'dan yeniden okur.
 */
const STORE_VERSION = 4

/** Collector'ın yerel deposu. Collector yazar, API okur (WAL modu ile eşzamanlı). */
export function openSqlite(): DatabaseSync {
  mkdirSync(dirname(env.sqlitePath), { recursive: true })
  // timeout: başka süreç (collector/API) kilitliyse beklesin, hemen hata vermesin
  const db = new DatabaseSync(env.sqlitePath, { timeout: 10_000 })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (v !== STORE_VERSION) {
    db.exec(`
      DROP TABLE IF EXISTS kv; DROP TABLE IF EXISTS bucket; DROP TABLE IF EXISTS stop_event; DROP TABLE IF EXISTS slow_event;
      DROP TABLE IF EXISTS spc_subgroup; DROP TABLE IF EXISTS risk; DROP TABLE IF EXISTS notification; DROP TABLE IF EXISTS sync_state;
      DROP TABLE IF EXISTS part_op; DROP TABLE IF EXISTS ncr; DROP TABLE IF EXISTS furnace_cycle;
      PRAGMA user_version = ${STORE_VERSION};
    `)
  }
  db.exec(`

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
      -- Ortak kanallar (makine tipine göre anlamı: src/sim/tags.ts); NULL = ölçüm yok
      temp        REAL,
      vib         REAL,
      hf          REAL,
      load        REAL,
      cur         REAL,
      aux         REAL,
      feed        REAL,
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

    -- Öngörücü bakım: 5 dk'da bir makine riski
    CREATE TABLE IF NOT EXISTS risk (
      machine_id TEXT    NOT NULL,
      t          INTEGER NOT NULL,
      risk       REAL    NOT NULL,
      level      TEXT    NOT NULL,
      factors    TEXT    NOT NULL,
      source     TEXT,
      PRIMARY KEY (machine_id, t)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS risk_t ON risk (t);

    -- Bakım bildirimleri (bizim veritabanımız; fabrikanın SQL Server'ına yazılmaz)
    CREATE TABLE IF NOT EXISTS notification (
      id          TEXT PRIMARY KEY,
      t           INTEGER NOT NULL,
      machine_id  TEXT    NOT NULL,
      line_id     TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      message     TEXT    NOT NULL,
      recipients  TEXT    NOT NULL,
      risk        REAL    NOT NULL,
      factors     TEXT    NOT NULL,
      source      TEXT,
      status      TEXT    NOT NULL DEFAULT 'new',
      status_at   INTEGER,
      failure_at  INTEGER
    );

    -- İzlenebilirlik: MES başlangıç/bitiş kayıtlarından birleştirilmiş operasyonlar
    CREATE TABLE IF NOT EXISTS part_op (
      serial      TEXT    NOT NULL,
      machine_id  TEXT    NOT NULL,
      start       INTEGER NOT NULL,
      part_number TEXT    NOT NULL,
      op          TEXT    NOT NULL,
      operator_id TEXT,
      end         INTEGER,
      result      TEXT,
      heat_no     TEXT,
      batch_no    TEXT,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (serial, machine_id, start)
    );
    CREATE INDEX IF NOT EXISTS part_op_upd ON part_op (updated_at);
    CREATE INDEX IF NOT EXISTS part_op_open ON part_op (serial, machine_id, end);

    -- Uygunsuzluk raporları + MRB kararı
    CREATE TABLE IF NOT EXISTS ncr (
      ncr_no         TEXT PRIMARY KEY,
      serial         TEXT    NOT NULL,
      part_number    TEXT    NOT NULL,
      machine_id     TEXT    NOT NULL,
      op             TEXT    NOT NULL,
      t              INTEGER NOT NULL,
      defect_type    TEXT    NOT NULL,
      disposition    TEXT,
      disposition_at INTEGER,
      updated_at     INTEGER NOT NULL
    );

    -- Fırın çevrimleri: reçete uyumu (AMS 2750)
    CREATE TABLE IF NOT EXISTS furnace_cycle (
      machine_id        TEXT    NOT NULL,
      start             INTEGER NOT NULL,
      end               INTEGER NOT NULL,
      hold_min          REAL    NOT NULL,
      min_dev           REAL    NOT NULL,
      max_dev           REAL    NOT NULL,
      setpoint_c        REAL    NOT NULL,
      required_hold_min REAL    NOT NULL,
      tolerance_c       REAL    NOT NULL,
      furnace_class     INTEGER NOT NULL,
      ok                INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      PRIMARY KEY (machine_id, start)
    );

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
