import express from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backup } from 'node:sqlite';
import nodemailer from 'nodemailer';
import { all, get, run, db, atomic, now, shopDate, hash, verify, seed, userColumns, rentalSelect, stockUsed } from './store.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Send a JSON request.' });
  }
  if (!['GET', 'HEAD'].includes(req.method) && (!req.body || Array.isArray(req.body))) {
    return res.status(400).json({ error: 'Send a JSON object.' });
  }
  const token = req.headers.cookie?.match(/(?:^|;\s*)racktrail=([a-f0-9]{64})(?:;|$)/)?.[1];
  req.token = token;
  if (token) req.user = get(`SELECT ${userColumns} FROM users WHERE active=1 AND id IN
    (SELECT userId FROM sessions WHERE token=? AND expires>?)`, digest(token), Date.now());
  next();
});

const customer = ['customer'];
const shop = ['staff', 'admin'];
const roles = [...customer, ...shop];
const categories = ['Gowns', 'Suits', 'Dresses', 'Skirts', 'Barongs', 'Blouses', 'Accessories'];
const token = () => randomBytes(32).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
const cookie = { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === '1', path: '/' };
const log = (actor, event) => run('INSERT INTO activity(actor,event,created) VALUES(?,?,?)', actor, event, now());
const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;

function need(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

function field(input, name, max = 120, optional = false) {
  const value = input[name];
  if (optional && (value === undefined || value === '')) return '';
  need(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max,
    `Enter a valid ${name} (up to ${max} characters).`);
  return value.trim();
}

function date(input, name) {
  const value = field(input, name, 10);
  const parsed = new Date(value + 'T00:00:00Z');
  need(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value,
    `Enter a valid ${name} date.`);
  return value;
}

function rentalDays(start, due) {
  const days = (Date.parse(due) - Date.parse(start)) / 86400000 + 1;
  need(days <= 365, 'Choose a date range of up to 365 days.');
  return days;
}

function number(input, name, max, integer = true) {
  const raw = field({ [name]: String(input[name] ?? '') }, name, 16);
  const value = Number(raw);
  need(/^\d+(?:\.\d{1,2})?$/.test(raw) && value <= max && (!integer || Number.isInteger(value)), `Enter a valid ${name}.`);
  return value;
}

function email(input) {
  const value = field(input, 'email').toLowerCase();
  need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Enter a valid email address.');
  return value;
}

function newPassword(input) {
  const value = input.password;
  need(typeof value === 'string' && value.length >= 8 && value.length <= 128, 'Use 8 to 128 characters for the password.');
  need(value === input.confirm, 'Passwords must match.');
  return hash(value);
}

function image(value, required = false) {
  if (!value && !required) return '';
  const match = typeof value === 'string' && value.length <= 2700000 &&
    value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  need(match, 'Upload a PNG, JPEG, or WebP image up to 2 MB.');
  const bytes = Buffer.from(match[2], 'base64');
  const signature = match[1] === 'png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' :
    match[1] === 'jpeg' ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff' :
      bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  need(signature && bytes.length <= 2_000_000, 'Upload a valid image up to 2 MB.');
  return value;
}

function route(method, path, allowed, action) {
  app[method]('/api' + path, async (req, res) => {
    if (allowed) {
      need(req.user, 'Log in to continue.', 401);
      need(allowed.includes(req.user.role), 'Your account cannot perform this action.', 403);
    }
    const result = await action(req, res);
    res.json(result ?? { ok: true });
  });
}

const attempts = new Map();
function limit(req) {
  const time = Date.now();
  for (const [key, entry] of attempts) if (entry.expires <= time) attempts.delete(key);
  const key = req.ip + req.path;
  const entry = attempts.get(key) || { count: 0, expires: time + 600000 };
  need(entry.count < 20, 'Too many attempts. Try again in a few minutes.', 429);
  entry.count++;
  attempts.set(key, entry);
}

const selectUser = id => get(`SELECT ${userColumns} FROM users WHERE id=?`, id);
const details = body => [field(body, 'name'), email(body), field(body, 'address', 250, true), field(body, 'phone', 25, true)];
function createUser(body, role) {
  const [name, addressEmail, address, phone] = details(body);
  need(!get('SELECT id FROM users WHERE email=?', addressEmail), 'This email is already registered.', 409);
  return Number(run('INSERT INTO users(name,email,address,phone,password,role) VALUES(?,?,?,?,?,?)',
    name, addressEmail, address, phone, newPassword(body), role).lastInsertRowid);
}

route('post', '/register', null, req => {
  limit(req);
  field(req.body, 'address', 250);
  atomic(() => createUser(req.body, 'customer'));
});
route('post', '/login', null, (req, res) => {
  limit(req);
  const user = get('SELECT * FROM users WHERE email=?', email(req.body));
  const password = req.body.password;
  need(typeof password === 'string' && password.length <= 128 && user?.active &&
    user.role === req.body.role && verify(password, user.password), 'Email, password, or selected role is incorrect.', 401);
  const session = token();
  atomic(() => {
    run('DELETE FROM sessions WHERE expires<=? OR token=?', Date.now(), req.token ? digest(req.token) : '');
    run('INSERT INTO sessions VALUES(?,?,?)', digest(session), user.id, Date.now() + 86400000 * 7);
    log(user.name, 'Signed in');
  });
  res.cookie('racktrail', session, { ...cookie, maxAge: 86400000 * 7 });
  return selectUser(user.id);
});
route('get', '/me', null, req => req.user ?? { user: null });
route('post', '/logout', null, (req, res) => {
  if (req.token) run('DELETE FROM sessions WHERE token=?', digest(req.token));
  res.clearCookie('racktrail', cookie);
});
route('post', '/forgot', null, async req => {
  limit(req);
  const address = email(req.body);
  need(transport && process.env.MAIL_FROM && process.env.APP_URL, 'Email recovery is unavailable. Contact the shop.', 503);
  const user = get('SELECT id,email FROM users WHERE email=? AND active=1', address);
  if (!user) return;
  const secret = token();
  atomic(() => {
    run('DELETE FROM resets WHERE userId=? OR expires<=?', user.id, Date.now());
    run('INSERT INTO resets VALUES(?,?,?)', digest(secret), user.id, Date.now() + 1800000);
  });
  const url = new URL('/?reset=' + secret, process.env.APP_URL);
  await transport.sendMail({ from: process.env.MAIL_FROM, to: user.email, subject: 'Reset your RackTrail password',
    text: `Open this link within 30 minutes to reset your RackTrail password: ${url}` });
});
route('post', '/reset', null, req => {
  limit(req);
  const key = digest(field(req.body, 'token', 64));
  const password = newPassword(req.body);
  atomic(() => {
    const reset = get('SELECT userId FROM resets JOIN users ON users.id=resets.userId WHERE token=? AND expires>? AND active=1', key, Date.now());
    need(reset, 'This reset link is invalid or expired.');
    run('UPDATE users SET password=? WHERE id=?', password, reset.userId);
    run('DELETE FROM resets WHERE userId=?', reset.userId);
    run('DELETE FROM sessions WHERE userId=?', reset.userId);
  });
});
route('patch', '/profile', roles, req => atomic(() => {
  const [name, addressEmail, address, phone] = details(req.body);
  need(!get('SELECT id FROM users WHERE email=? AND id<>?', addressEmail, req.user.id), 'This email is already registered.', 409);
  if (addressEmail !== req.user.email) {
    need(verify(field(req.body, 'current password', 128), get('SELECT password FROM users WHERE id=?', req.user.id).password),
      'Enter your current password to change your email.');
    run('DELETE FROM resets WHERE userId=?', req.user.id);
  }
  run('UPDATE users SET name=?,email=?,address=?,phone=? WHERE id=?', name, addressEmail, address, phone, req.user.id);
  return selectUser(req.user.id);
}));
route('patch', '/password', roles, req => atomic(() => {
  const current = get('SELECT password FROM users WHERE id=?', req.user.id);
  need(verify(field(req.body, 'current password', 128), current.password), 'Current password is incorrect.');
  run('UPDATE users SET password=? WHERE id=?', newPassword(req.body), req.user.id);
  run('DELETE FROM sessions WHERE userId=? AND token<>?', req.user.id, digest(req.token));
  run('DELETE FROM resets WHERE userId=?', req.user.id);
}));
route('patch', '/settings', roles, req => {
  need(typeof req.body.reminders === 'boolean', 'Choose a reminder preference.');
  run('UPDATE users SET reminders=? WHERE id=?', Number(req.body.reminders), req.user.id);
  return selectUser(req.user.id);
});

route('get', '/items', roles, () => {
  const today = shopDate();
  return all('SELECT * FROM items WHERE archived=0 ORDER BY id').map(item =>
    ({ ...item, available: Math.max(0, item.stock - stockUsed(item.id, today, today)) }));
});
route('get', '/items/:id/availability', customer, req => {
  const item = get('SELECT stock,price FROM items WHERE id=? AND archived=0', req.params.id);
  need(item, 'Item not found.', 404);
  const start = date(req.query, 'start');
  const due = date(req.query, 'due');
  need(start >= shopDate() && due >= start, 'Choose valid rental dates.');
  return {
    total: item.price * rentalDays(start, due),
    available: Math.max(0, item.stock - stockUsed(req.params.id, start, due))
  };
});
function saveItem(req) {
  const body = req.body;
  const id = req.params.id;
  const category = field(body, 'category');
  need(categories.includes(category), 'Choose a valid category.');
  const stock = number(body, 'stock', 10000);
  const price = Math.round(number(body, 'price', 1000000, false) * 100);
  need(price > 0, 'Enter a daily price greater than zero.');
  const fields = [field(body, 'name'), category, field(body, 'size', 40), price, stock,
    field(body, 'description', 2000), field(body, 'condition', 120)];
  return atomic(() => {
    const existing = id && get('SELECT * FROM items WHERE id=? AND archived=0', id);
    need(!id || existing, 'Item not found.', 404);
    const picture = body.image === undefined ? existing?.image || '' : image(body.image);
    if (existing) {
      need(stock >= stockUsed(id, shopDate(), '9999-12-31'), 'Stock cannot be lower than existing bookings.', 409);
      run('UPDATE items SET name=?,category=?,size=?,price=?,stock=?,description=?,condition=?,image=? WHERE id=?',
        ...fields, picture, id);
    } else run('INSERT INTO items(name,category,size,price,stock,description,condition,image) VALUES(?,?,?,?,?,?,?,?)', ...fields, picture);
    log(req.user.name, (existing ? 'Updated item ' : 'Added item ') + fields[0]);
  });
}
route('post', '/items', shop, saveItem);
route('patch', '/items/:id', shop, saveItem);
route('delete', '/items/:id', shop, req => atomic(() => {
  need(!get("SELECT id FROM rentals WHERE itemId=? AND status IN ('Pending','Reserved','Active')", req.params.id),
    'Close open bookings before removing this item.', 409);
  need(run('UPDATE items SET archived=1 WHERE id=? AND archived=0', req.params.id).changes, 'Item not found.', 404);
  log(req.user.name, 'Removed item #' + req.params.id);
}));

route('get', '/users', shop, req => all(`SELECT ${userColumns} FROM users WHERE
  role='customer' OR ?='admin' ORDER BY id`, req.user.role));
route('get', '/dashboard/counts', shop, req => get(`
  SELECT (SELECT COUNT(*) FROM items WHERE archived=0) AS itemCount,
    (SELECT COUNT(*) FROM users WHERE role='customer' OR ?='admin') AS userCount
`, req.user.role));
route('post', '/users', ['admin'], req => atomic(() => {
  need(roles.includes(req.body.role), 'Choose a valid role.');
  const id = createUser(req.body, req.body.role);
  log(req.user.name, 'Created account #' + id);
}));
route('patch', '/users/:id', ['admin'], req => atomic(() => {
  const user = selectUser(req.params.id);
  need(user, 'Account not found.', 404);
  need(user.id !== req.user.id, 'Edit your own account under Profile.', 409);
  const [name, addressEmail, address, phone] = details(req.body);
  const { role, active } = req.body;
  need(roles.includes(role) && typeof active === 'boolean', 'Choose a valid role and account status.');
  need(!get('SELECT id FROM users WHERE email=? AND id<>?', addressEmail, user.id), 'This email is already registered.', 409);
  need(role === 'customer' || !get('SELECT id FROM rentals WHERE userId=? LIMIT 1', user.id) &&
    !get('SELECT id FROM messages WHERE userId=? LIMIT 1', user.id), 'Accounts with customer records must retain the customer role.', 409);
  run('UPDATE users SET name=?,email=?,address=?,phone=?,role=?,active=? WHERE id=?',
    name, addressEmail, address, phone, role, Number(active), user.id);
  if (req.body.password) run('UPDATE users SET password=? WHERE id=?', newPassword(req.body), user.id);
  run('DELETE FROM sessions WHERE userId=?', user.id);
  run('DELETE FROM resets WHERE userId=?', user.id);
  log(req.user.name, 'Updated account #' + user.id);
}));
route('delete', '/users/:id', ['admin'], req => atomic(() => {
  const user = selectUser(req.params.id);
  need(user, 'Account not found.', 404);
  need(user.id !== req.user.id, 'You cannot delete your own account.');
  const referenced = get(`SELECT EXISTS(SELECT 1 FROM rentals WHERE userId=?)
    OR EXISTS(SELECT 1 FROM messages WHERE userId=? OR senderId=?)
    OR EXISTS(SELECT 1 FROM reports WHERE userId=?) AS found`, user.id, user.id, user.id, user.id);
  need(!referenced.found, 'This account has history. Deactivate it to preserve records.', 409);
  run('DELETE FROM sessions WHERE userId=?', user.id);
  run('DELETE FROM resets WHERE userId=?', user.id);
  run('DELETE FROM users WHERE id=?', user.id);
  log(req.user.name, 'Deleted account #' + user.id);
}));

route('get', '/rentals', roles, req => all(rentalSelect + ' WHERE (?<>\'customer\' OR r.userId=?) ORDER BY r.id DESC',
  shopDate(), req.user.role, req.user.id));
route('get', '/payment-config', customer, () => ({ qr: process.env.GCASH_QR_URL || '' }));
route('post', '/rentals', customer, req => {
  const body = req.body;
  const itemId = number(body, 'itemId', Number.MAX_SAFE_INTEGER);
  const start = date(body, 'start');
  const due = date(body, 'due');
  const kind = field(body, 'kind');
  const today = shopDate();
  need(['Rent', 'Reserve'].includes(kind), 'Choose rent or reserve.');
  need(start >= today && due >= start && (kind !== 'Reserve' || start > today),
    'Choose a valid date range. Reservations must start on a future day.');
  const days = rentalDays(start, due);
  const method = field(body, 'method');
  need(['Cash on Pickup', 'GCash'].includes(method), 'Choose a payment method.');
  need(method !== 'GCash' || process.env.GCASH_QR_URL, 'GCash is unavailable. Choose Cash on Pickup.');
  const reference = method === 'GCash' ? field(body, 'reference', 40).replace(/\s/g, '').toUpperCase() : null;
  need(!reference || /^[A-Z0-9-]+$/.test(reference), 'Enter a valid GCash reference number.');
  const receipt = reference ? image(body.receipt, true) : null;
  const name = field(body, 'name');
  const address = field(body, 'address', 250);
  const phone = field(body, 'phone', 25);
  need(/^\+?[0-9 ()-]{7,25}$/.test(phone) && phone.replace(/\D/g, '').length >= 7, 'Enter a valid contact number.');
  const message = field(body, 'message', 2000, true);
  return atomic(() => {
    const item = get('SELECT name,price,stock FROM items WHERE id=? AND archived=0', itemId);
    need(item, 'Item not found.', 404);
    const total = item.price * days;
    need(body.total === total, method === 'GCash'
      ? 'The rental price changed. If you already paid, contact the shop before paying again. Otherwise, go back to review the new total.'
      : 'The rental price changed. Go back to the form to review the new total.', 409);
    need(stockUsed(itemId, start, due, today) < item.stock, 'This item is fully booked for those dates.', 409);
    need(!reference || !get('SELECT rentalId FROM payments WHERE reference=?', reference), 'That GCash reference was already used.', 409);
    const id = Number(run(`INSERT INTO rentals
      (userId,itemId,itemName,name,address,phone,start,due,message,kind,status,total,created)
      VALUES(?,?,?,?,?,?,?,?,?,?,'Pending',?,?)`,
    req.user.id, itemId, item.name, name, address, phone, start, due, message, kind, total, now()).lastInsertRowid);
    run("INSERT INTO payments(rentalId,method,reference,receipt,state) VALUES(?,?,?,?,'Pending')", id, method, reference, receipt);
    return { id };
  });
});
route('get', '/rentals/:id/receipt', roles, req => {
  const receipt = get(`SELECT p.receipt FROM payments p JOIN rentals r ON r.id=p.rentalId
    WHERE r.id=? AND (?<>'customer' OR r.userId=?)`, req.params.id, req.user.role, req.user.id)?.receipt;
  need(receipt, 'Receipt not found.', 404);
  return { receipt };
});
route('patch', '/rentals/:id', shop, req => atomic(() => {
  const rental = get(rentalSelect + ' WHERE r.id=?', shopDate(), req.params.id);
  need(rental, 'Transaction not found.', 404);
  const { action } = req.body;
  const open = ['Pending', 'Reserved'].includes(rental.status);
  if (action === 'verify' || action === 'reject-payment') {
    need(open && rental.payment === 'Pending', 'This payment has already been reviewed.', 409);
    need(rental.method === 'GCash' || action === 'verify', 'Only submitted GCash payments can be rejected.');
    run('UPDATE payments SET state=?,paidAt=? WHERE rentalId=?',
      action === 'verify' ? 'Verified' : 'Rejected', action === 'verify' ? now() : null, rental.id);
    if (action === 'reject-payment') run("UPDATE rentals SET status='Rejected' WHERE id=?", rental.id);
  } else if (action === 'reserve') {
    need(rental.status === 'Pending' && rental.kind === 'Reserve' && rental.due >= shopDate() &&
      (rental.method === 'Cash on Pickup' || rental.payment === 'Verified'), 'This reservation is not ready to confirm.', 409);
    run("UPDATE rentals SET status='Reserved' WHERE id=?", rental.id);
  } else if (action === 'release') {
    const today = shopDate();
    need(open && rental.payment === 'Verified' && today >= rental.start && today <= rental.due,
      'Verify payment and release within the booked dates.', 409);
    const inUse = get("SELECT COUNT(*) AS count FROM rentals WHERE itemId=? AND status='Active'", rental.itemId).count;
    const { stock } = get('SELECT stock FROM items WHERE id=?', rental.itemId);
    need(inUse < stock, 'All copies are still checked out. Process returns before releasing this item.', 409);
    run("UPDATE rentals SET status='Active' WHERE id=?", rental.id);
  } else if (action === 'return') {
    need(rental.status === 'Active', 'Only released items can be returned.', 409);
    run("UPDATE rentals SET status='Returned',returned=?,inspection=?,penalty=? WHERE id=?",
      now(), field(req.body, 'inspection', 1000), Math.round(number(req.body, 'penalty', 100000, false) * 100), rental.id);
  } else if (action === 'reject') {
    need(open && rental.payment !== 'Verified', 'A paid booking needs payment reconciliation before rejection.', 409);
    run("UPDATE rentals SET status='Rejected' WHERE id=?", rental.id);
    run("UPDATE payments SET state='Rejected' WHERE rentalId=?", rental.id);
  } else need(false, 'Choose a valid transaction action.');
  log(req.user.name, action + ' · transaction #' + rental.id);
}));

route('get', '/messages', roles, req => all(`SELECT m.*,u.name AS sender,s.name AS customer FROM messages m
  JOIN users u ON u.id=m.senderId JOIN users s ON s.id=m.userId
  WHERE (?<>'customer' OR m.userId=?) ORDER BY m.id`, req.user.role, req.user.id));
route('post', '/messages', roles, req => {
  const id = req.user.role === 'customer' ? req.user.id : number(req.body, 'userId', Number.MAX_SAFE_INTEGER);
  need(get("SELECT id FROM users WHERE id=? AND role='customer'", id), 'Customer not found.', 404);
  run('INSERT INTO messages(userId,senderId,body,created) VALUES(?,?,?,?)', id, req.user.id, field(req.body, 'body', 2000), now());
});
route('get', '/activity', ['admin'], () => all('SELECT * FROM activity ORDER BY id DESC LIMIT 20'));
route('get', '/notifications', roles, req => {
  const today = shopDate();
  const tomorrow = shopDate(Date.now() + 86400000);
  return req.user.reminders ? all(rentalSelect + ` WHERE (?<>'customer' OR r.userId=?)
    AND ((r.status='Active' AND r.due<=?) OR (r.status<>'Returned' AND p.method='GCash' AND p.state<>'Pending'))
    ORDER BY r.id DESC LIMIT 30`, today, req.user.role, req.user.id, tomorrow).map(row => ({
      id: row.id, text: row.status === 'Active' && row.due <= tomorrow
        ? `${row.itemName} is ${row.due < today ? 'overdue' : 'due ' + row.due}.`
        : `${row.itemName} GCash payment: ${row.payment.toLowerCase()}.`
    })) : [];
});
route('post', '/reports', shop, req => {
  const from = date(req.body, 'from');
  const to = date(req.body, 'to');
  const type = field(req.body, 'type');
  need(to >= from && Date.parse(to) - Date.parse(from) <= 366 * 86400000, 'Choose a report range of up to one year.');
  need(['Transactions', 'Payments', 'Inventory'].includes(type), 'Choose a valid report type.');
  const rows = all(rentalSelect + ' ORDER BY r.id DESC', shopDate());
  const period = rows.filter(row => shopDate(row.created) >= from && shopDate(row.created) <= to);
  const rented = period.filter(row => ['Active', 'Returned'].includes(row.status));
  const counts = new Map();
  for (const row of rented) counts.set(row.itemName, (counts.get(row.itemName) || 0) + 1);
  const reportRows = type === 'Payments'
    ? rows.filter(row => shopDate(row.paidAt || row.created) >= from && shopDate(row.paidAt || row.created) <= to)
    : period;
  const result = {
    type, from, to, transactions: period.length, rented: rented.length,
    overdue: period.filter(row => row.displayStatus === 'Overdue').length,
    revenue: rows.filter(row => row.paidAt && shopDate(row.paidAt) >= from && shopDate(row.paidAt) <= to)
      .reduce((sum, row) => sum + row.total, 0),
    top: [...counts].sort((a, b) => b[1] - a[1]),
    rows: reportRows.map(({ created, paidAt, name, itemName, total, method, payment, displayStatus }) =>
      ({ created, paidAt, name, itemName, total, method, payment, displayStatus })),
    inventory: type === 'Inventory' ? all('SELECT name,category,stock,condition FROM items WHERE archived=0 ORDER BY name') : []
  };
  run('INSERT INTO reports(userId,created,data) VALUES(?,?,?)', req.user.id, now(), JSON.stringify(result));
  return result;
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
if (existsSync('dist')) app.use(express.static('dist'));
app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500 && !error.status) console.error(error);
  res.status(status).json({ error: status >= 500 && !error.status ? 'Something went wrong. Try again.' : error.message });
});

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  seed();
  if (process.env.BACKUP_DIR) {
    const folder = process.env.BACKUP_DIR;
    mkdirSync(folder, { recursive: true });
    const daily = async () => {
      const filename = `racktrail-${shopDate()}.sqlite`;
      if (existsSync(resolve(folder, filename))) return;
      try {
        const temporary = resolve(folder, filename + '.partial');
        if (existsSync(temporary)) unlinkSync(temporary);
        await backup(db, temporary);
        renameSync(temporary, resolve(folder, filename));
        const names = readdirSync(folder).filter(name => /^racktrail-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).sort();
        for (const name of names.slice(0, -14)) unlinkSync(resolve(folder, name));
      } catch (error) { console.error('Backup failed:', error); }
    };
    await daily();
    setInterval(daily, 3600000).unref();
  }
  const port = Number(process.env.PORT || 3001);
  app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`RackTrail running on port ${port}`));
}
