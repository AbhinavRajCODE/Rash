/*
 * db.js — Persistent storage for Rash, the AI study companion.
 *
 * Uses Node's built-in SQLite (`node:sqlite`, Node 22.5+ / 22.17 tested)
 * which requires ZERO native compilation — perfect for Raspberry Pi Zero 2 W.
 *
 * If `node:sqlite` is unavailable (older Node), we transparently fall back
 * to a JSON-file store so the app always runs.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'companion.db');
const JSON_PATH = path.join(DATA_DIR, 'companion.json');

let sqlite = null;
let db = null;
let useSqlite = true;

try {
  sqlite = require('node:sqlite');
} catch (e) {
  sqlite = null;
}

/* ---------------- SQLite helpers ---------------- */

function sqliteInit() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new sqlite.DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session
      ON messages(session_id, id);

    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subject TEXT DEFAULT '',
      date TEXT NOT NULL,           -- YYYY-MM-DD
      time TEXT DEFAULT '',         -- HH:MM  (24h)
      priority TEXT DEFAULT 'normal',
      completed INTEGER DEFAULT 0,
      note TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date);

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      subject TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  console.log('🗄️  SQLite database ready:', DB_PATH);
}

/* ---------------- JSON fallback ---------------- */

function jsonInit() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let data = { messages: [], schedule: [], notes: [], settings: {} };
  if (fs.existsSync(JSON_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    } catch (e) {
      console.warn('⚠️  Corrupt JSON store, starting fresh.');
    }
  }
  json = data;
  console.log('🗄️  JSON storage ready:', JSON_PATH);
}

let json = null;

function jsonSave() {
  fs.writeFileSync(JSON_PATH, JSON.stringify(json, null, 2), 'utf8');
}

function init() {
  if (sqlite) {
    try {
      sqliteInit();
      useSqlite = true;
      return;
    } catch (e) {
      console.warn('⚠️  node:sqlite init failed, using JSON fallback:', e.message);
      useSqlite = false;
    }
  }
  jsonInit();
}

/* ================================================================
   Messages (persistent chat history)
   ================================================================ */

function addMessage(sessionId, role, content) {
  const now = Date.now();
  if (useSqlite) {
    const stmt = db.prepare(
      'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    );
    const info = stmt.run(sessionId, role, content, now);
    return { id: Number(info.lastInsertRowid), session_id: sessionId, role, content, created_at: now };
  }
  const msg = { id: json.messages.length + 1, session_id: sessionId, role, content, created_at: now };
  json.messages.push(msg);
  jsonSave();
  return msg;
}

function getMessages(sessionId, limit = 50) {
  if (useSqlite) {
    const rows = db
      .prepare(
        'SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(sessionId, limit);
    return rows.reverse();
  }
  return json.messages
    .filter((m) => m.session_id === sessionId)
    .slice(-limit);
}

function clearMessages(sessionId) {
  if (useSqlite) {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    return;
  }
  json.messages = json.messages.filter((m) => m.session_id !== sessionId);
  jsonSave();
}

/* ================================================================
   Schedule
   ================================================================ */

function listSchedule(date) {
  if (useSqlite) {
    if (date) {
      return db
        .prepare('SELECT * FROM schedule WHERE date = ? ORDER BY completed ASC, time ASC')
        .all(date);
    }
    return db.prepare('SELECT * FROM schedule ORDER BY date ASC, time ASC').all();
  }
  let items = json.schedule.slice();
  if (date) items = items.filter((s) => s.date === date);
  items.sort((a, b) => (a.completed - b.completed) || (a.time || '').localeCompare(b.time || ''));
  return items;
}

function getUpcoming(days = 7) {
  const ist = getIST();
  const start = todayStr();
  // End date = today + days in IST
  const endDate = new Date(ist.year, ist.month - 1, ist.day + days);
  const end = toDateStr(endDate);
  if (useSqlite) {
    return db
      .prepare(
        'SELECT * FROM schedule WHERE date BETWEEN ? AND ? ORDER BY completed ASC, date ASC, time ASC'
      )
      .all(start, end);
  }
  return json.schedule
    .filter((s) => s.date >= start && s.date <= end)
    .sort((a, b) => (a.completed - b.completed) || a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

function addSchedule(item) {
  const { title, subject = '', date, time = '', priority = 'normal', note = '' } = item;
  const completed = item.completed ? 1 : 0;
  const now = Date.now();
  if (useSqlite) {
    const stmt = db.prepare(
      'INSERT INTO schedule (title, subject, date, time, priority, completed, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const info = stmt.run(title, subject, date, time, priority, completed, note, now);
    return getScheduleById(Number(info.lastInsertRowid));
  }
  const rec = {
    id: json.schedule.length + 1,
    title,
    subject,
    date,
    time,
    priority,
    completed,
    note,
    created_at: now,
  };
  json.schedule.push(rec);
  jsonSave();
  return rec;
}

function getScheduleById(id) {
  if (useSqlite) {
    return db.prepare('SELECT * FROM schedule WHERE id = ?').get(id);
  }
  return json.schedule.find((s) => s.id === id);
}

function updateSchedule(id, fields) {
  if (useSqlite) {
    const allowed = ['title', 'subject', 'date', 'time', 'priority', 'completed', 'note'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(k + ' = ?');
        vals.push(k === 'completed' ? (fields[k] ? 1 : 0) : fields[k]);
      }
    }
    if (!sets.length) return getScheduleById(id);
    vals.push(id);
    db.prepare('UPDATE schedule SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    return getScheduleById(id);
  }
  const rec = json.schedule.find((s) => s.id === id);
  if (!rec) return null;
  const allowed = ['title', 'subject', 'date', 'time', 'priority', 'completed', 'note'];
  for (const k of allowed) {
    if (fields[k] !== undefined) rec[k] = fields[k];
  }
  jsonSave();
  return rec;
}

function deleteSchedule(id) {
  if (useSqlite) {
    db.prepare('DELETE FROM schedule WHERE id = ?').run(id);
    return;
  }
  json.schedule = json.schedule.filter((s) => s.id !== id);
  jsonSave();
}

function deleteSchedules(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => n > 0);
  if (!list.length) return 0;
  if (useSqlite) {
    const placeholders = list.map(() => '?').join(',');
    const info = db.prepare('DELETE FROM schedule WHERE id IN (' + placeholders + ')').run(...list);
    return Number(info.changes);
  }
  const before = json.schedule.length;
  json.schedule = json.schedule.filter((s) => !list.includes(s.id));
  jsonSave();
  return before - json.schedule.length;
}

function completeSchedule(id, done) {
  return updateSchedule(id, { completed: done ? 1 : 0 });
}

/* ================================================================
   Notes
   ================================================================ */

function listNotes() {
  if (useSqlite) {
    return db
      .prepare('SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC')
      .all();
  }
  return json.notes
    .slice()
    .sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at));
}

function addNote({ title, content, subject = '', pinned = 0 }) {
  const now = Date.now();
  if (useSqlite) {
    const stmt = db.prepare(
      'INSERT INTO notes (title, content, subject, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const info = stmt.run(title, content, subject, pinned ? 1 : 0, now, now);
    return getNoteById(Number(info.lastInsertRowid));
  }
  const rec = { id: json.notes.length + 1, title, content, subject, pinned: pinned ? 1 : 0, created_at: now, updated_at: now };
  json.notes.push(rec);
  jsonSave();
  return rec;
}

function getNoteById(id) {
  if (useSqlite) {
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  }
  return json.notes.find((n) => n.id === id);
}

function updateNote(id, fields) {
  const allowed = ['title', 'content', 'subject', 'pinned'];
  const updates = {};
  for (const k of allowed) {
    if (fields[k] !== undefined) updates[k] = fields[k];
  }
  updates.updated_at = Date.now();
  if (useSqlite) {
    const sets = [];
    const vals = [];
    for (const k of Object.keys(updates)) {
      sets.push(k + ' = ?');
      vals.push(updates[k]);
    }
    vals.push(id);
    db.prepare('UPDATE notes SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    return getNoteById(id);
  }
  const rec = json.notes.find((n) => n.id === id);
  if (!rec) return null;
  Object.assign(rec, updates);
  jsonSave();
  return rec;
}

function deleteNote(id) {
  if (useSqlite) {
    db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return;
  }
  json.notes = json.notes.filter((n) => n.id !== id);
  jsonSave();
}

/* ---------------- Notes: search ---------------- */

function searchNotes(query) {
  const q = (query || '').toString().trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return [];
  if (useSqlite) {
    const like = terms.map(() => '(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(subject) LIKE ?)').join(' AND ');
    const params = [];
    for (const t of terms) {
      const pat = '%' + t + '%';
      params.push(pat, pat, pat);
    }
    return db
      .prepare('SELECT * FROM notes WHERE ' + like + ' ORDER BY pinned DESC, updated_at DESC LIMIT 10')
      .all(...params);
  }
  return json.notes
    .filter((n) =>
      terms.every((t) =>
        (n.title || '').toLowerCase().includes(t) ||
        (n.content || '').toLowerCase().includes(t) ||
        (n.subject || '').toLowerCase().includes(t)
      )
    )
    .slice(0, 10);
}

function deleteNotes(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => n > 0);
  if (!list.length) return 0;
  if (useSqlite) {
    const placeholders = list.map(() => '?').join(',');
    const info = db.prepare('DELETE FROM notes WHERE id IN (' + placeholders + ')').run(...list);
    return Number(info.changes);
  }
  const before = json.notes.length;
  json.notes = json.notes.filter((n) => !list.includes(n.id));
  jsonSave();
  return before - json.notes.length;
}

/* ================================================================
   Settings
   ================================================================ */

function getSetting(key, def = null) {
  if (useSqlite) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : def;
  }
  return json.settings[key] !== undefined ? json.settings[key] : def;
}

function setSetting(key, value) {
  if (useSqlite) {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, String(value));
    return;
  }
  json.settings[key] = String(value);
  jsonSave();
}

/* ---------------- IST date helpers (Indian Standard Time, UTC+5:30) ---------------- */

/**
 * Returns an object with the current date/time components in IST.
 * This is the single source of truth for all date/time operations,
 * ensuring the bot never confuses dates across timezone boundaries.
 */
function getIST() {
  const formatter = new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD format
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    // Build a Date object that behaves as if it's in IST
    toDate: () => new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  };
}

/**
 * Convert a Date object (or nothing for today) to IST date string YYYY-MM-DD.
 */
function toDateStr(d) {
  if (!d) {
    const ist = getIST();
    return `${ist.year}-${String(ist.month).padStart(2, '0')}-${String(ist.day).padStart(2, '0')}`;
  }
  // If a Date object is given, convert it to IST
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(d);
}

function todayStr() {
  return toDateStr();
}

function nowTimeStr() {
  const ist = getIST();
  return `${String(ist.hour).padStart(2, '0')}:${String(ist.minute).padStart(2, '0')}`;
}

module.exports = {
  init,
  addMessage,
  getMessages,
  clearMessages,
  listSchedule,
  getUpcoming,
  addSchedule,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
  deleteSchedules,
  completeSchedule,
  listNotes,
  addNote,
  getNoteById,
  updateNote,
  deleteNote,
  searchNotes,
  deleteNotes,
  getSetting,
  setSetting,
  getIST,
  toDateStr,
  todayStr,
  nowTimeStr,
};

