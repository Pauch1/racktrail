import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const file = process.env.DB_FILE || 'data/racktrail.sqlite';
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, address TEXT NOT NULL,
    phone TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    reminders INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resets (
    token TEXT PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, size TEXT NOT NULL,
    price INTEGER NOT NULL, stock INTEGER NOT NULL, description TEXT NOT NULL,
    condition TEXT NOT NULL, image TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rentals (
    id INTEGER PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id), itemId INTEGER NOT NULL REFERENCES items(id),
    itemName TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL,
    start TEXT NOT NULL, due TEXT NOT NULL, message TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
    total INTEGER NOT NULL, created TEXT NOT NULL, returned TEXT, inspection TEXT, penalty INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS rentals_item_dates ON rentals(itemId, start, due);
  CREATE TABLE IF NOT EXISTS payments (
    rentalId INTEGER PRIMARY KEY REFERENCES rentals(id), method TEXT NOT NULL,
    reference TEXT UNIQUE, receipt TEXT, state TEXT NOT NULL, paidAt TEXT
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id), senderId INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL, created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY, actor TEXT NOT NULL, event TEXT NOT NULL, created TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id), created TEXT NOT NULL, data TEXT NOT NULL
  );
`);
export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);
export function atomic(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export const now = () => new Date().toISOString();
export const shopDate = (value = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(value));
export function hash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function verify(password, saved) {
  const [salt, key] = saved.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'));
}
export const userColumns = 'id, name, email, address, phone, role, active, reminders';
export const rentalSelect = `SELECT r.*, p.method, p.reference, p.state AS payment, p.paidAt,
  p.receipt IS NOT NULL AS hasReceipt, CASE WHEN r.status='Active' AND r.due < ?
  THEN 'Overdue' ELSE r.status END AS displayStatus FROM rentals r JOIN payments p ON p.rentalId=r.id`;

export function stockUsed(itemId, start, due, today = shopDate()) {
  const bookings = all(`SELECT start, due, status FROM rentals WHERE itemId=?
    AND status IN ('Pending','Reserved','Active') AND start<=?
    AND (due>=? OR (status='Active' AND due<?))`, itemId, due, start, today);
  const events = [];
  for (const booking of bookings) {
    events.push([booking.start < start ? start : booking.start, 1]);
    events.push([booking.status === 'Active' && booking.due < today ? due : booking.due, -1]);
  }
  events.sort(([dateA, deltaA], [dateB, deltaB]) => dateA.localeCompare(dateB) || deltaB - deltaA);
  let used = 0;
  let peak = 0;
  for (const [, delta] of events) {
    used += delta;
    peak = Math.max(peak, used);
  }
  return peak;
}

export function seed() {
  const production = process.env.NODE_ENV === 'production';
  if (production && get("SELECT id FROM users WHERE email LIKE '%@racktrail.test'")) {
    throw new Error('Production requires a dedicated database without demo accounts.');
  }
  if (!get('SELECT id FROM users LIMIT 1')) {
    if (production && (!process.env.ADMIN_EMAIL || process.env.ADMIN_EMAIL.endsWith('@racktrail.test') ||
        !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12 || process.env.ADMIN_PASSWORD === 'RackTrail123!')) {
      throw new Error('Set a shop ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least 12 characters before first production start.');
    }
    const accounts = [['RackTrail Admin', process.env.ADMIN_EMAIL || 'admin@racktrail.test', 'admin', process.env.ADMIN_PASSWORD]];
    if (!production) accounts.push(
      ['Shop Staff', 'staff@racktrail.test', 'staff'],
      ['Demo Customer', 'customer@racktrail.test', 'customer']
    );
    for (const [name, email, role, password] of accounts) {
      run('INSERT INTO users(name,email,address,phone,role,password) VALUES(?,?,?,?,?,?)',
        name, email.toLowerCase(), 'Victoria, Oriental Mindoro', '09123456789', role, hash(password || 'RackTrail123!'));
    }
  }
  if (!production && !get('SELECT id FROM items LIMIT 1')) {
    for (const [name, category, size, price, stock, description, image] of [
      ['Evening Gown', 'Gowns', 'M', 50000, 4, 'Elegant evening gown suitable for formal events.', '/gown.webp'],
      ["Men’s Suit", 'Suits', 'L', 80000, 3, 'Classic suit for weddings and formal occasions.', '/suit.webp'],
      ['Blouse', 'Blouses', 'M', 30000, 8, 'Light blouse for special occasions.', '/blouse.webp']
    ]) run("INSERT INTO items(name,category,size,price,stock,description,image,condition) VALUES(?,?,?,?,?,?,?,'Good')",
      name, category, size, price, stock, description, image);
  }
}
