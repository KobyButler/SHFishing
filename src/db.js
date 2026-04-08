import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';

const dbPath = path.join(process.cwd(), 'db', 'data.sqlite');
let db = null;

const loadSqlJs = async () => {
  const distPath = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist');
  return initSqlJs({
    locateFile: (file) => path.join(distPath, file)
  });
};

const persist = () => {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
};

const prepare = (sql) => ({
  get: (...params) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  },
  all: (...params) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },
  run: (...params) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
    const row = db.exec('SELECT last_insert_rowid() as id');
    persist();
    return {
      lastInsertRowid: row?.[0]?.values?.[0]?.[0] ?? null
    };
  }
});

const init = async () => {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const SQL = await loadSqlJs();
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      duration_hours INTEGER NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL,
      start_times_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      is_blocked INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      UNIQUE(service_id, date, time)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      guests INTEGER NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_notes TEXT,
      proposed_date TEXT,
      proposed_time TEXT,
      created_at TEXT NOT NULL,
      member_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS gallery_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      caption TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id TEXT UNIQUE,
      email TEXT NOT NULL,
      name TEXT,
      stripe_customer_id TEXT,
      stripe_default_payment_method TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member_saved_trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      member_id INTEGER,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      payment_mode TEXT,
      stripe_customer_id TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const getColumns = (table) => {
    const result = db.exec(`PRAGMA table_info(${table});`);
    if (!result?.[0]?.values) return [];
    return result[0].values.map((row) => row[1]);
  };

  const ensureColumn = (table, column, definition) => {
    const columns = getColumns(table);
    if (!columns.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
    }
  };

  ensureColumn('bookings', 'member_id', 'member_id INTEGER');
  ensureColumn('members', 'stripe_customer_id', 'stripe_customer_id TEXT');
  ensureColumn('members', 'stripe_default_payment_method', 'stripe_default_payment_method TEXT');
  ensureColumn('payments', 'stripe_payment_intent', 'stripe_payment_intent TEXT');
  ensureColumn('payments', 'payment_mode', 'payment_mode TEXT');
  ensureColumn('payments', 'stripe_customer_id', 'stripe_customer_id TEXT');

  persist();
};

const getSetting = (key, fallback = '') => {
  const row = prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};

const setSetting = (key, value) => {
  prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
};

const ensureUploads = () => {
  const dirs = [
    path.join(process.cwd(), 'public', 'uploads', 'gallery'),
    path.join(process.cwd(), 'public', 'uploads', 'logo'),
    path.join(process.cwd(), 'public', 'uploads', 'species')
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
};

export { init, getSetting, setSetting, ensureUploads, prepare };
