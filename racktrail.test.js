import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.DB_FILE = ':memory:';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.GCASH_QR_URL = '/test-qr.png';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = '0';
const { app } = await import('./server.js');
const { seed, all, get, run, atomic, now, db, shopDate, stockUsed, close } = await import('./store.js');

test('booking, staff review, return, reports and role boundaries', async t => {
  await seed();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const rollback = atomic(async () => {
    await run('INSERT INTO activity(actor,event,created) VALUES(?,?,?)','queue-test','rollback',now());
    entered.resolve();
    await release.promise;
    throw new Error('Expected transaction rollback');
  });
  await entered.promise;
  let readFinished = false;
  const unrelatedRead = get("SELECT id FROM activity WHERE actor='queue-test'").then(row => {
    readFinished = true;
    return row;
  });
  await new Promise(setImmediate);
  if (db) assert.equal(readFinished,false);
  release.resolve();
  await assert.rejects(rollback,/Expected transaction rollback/);
  assert.equal(await unrelatedRead,undefined);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await close();
  });
  const root = 'http://127.0.0.1:' + server.address().port + '/api';

  async function request(path, { method = 'GET', cookie = '', body, status = 200 } = {}) {
    const response = await fetch(root + path, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return { data, cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
  }
  async function login(role, address = role + '@racktrail.test') {
    return (await request('/login', { method: 'POST', body: {
      email: address, password: 'RackTrail123!', role
    }})).cookie;
  }

  const today = shopDate();
  assert.deepEqual((await request('/health')).data,{ok:true});
  const tomorrow = shopDate(Date.now() + 86400000);
  const afterTomorrow = shopDate(Date.now() + 2 * 86400000);
  const registration = { name:'New Customer', email:'new@racktrail.test', address:'Victoria', phone:'09123456789', password:'RackTrail123!' };
  await request('/register', { method:'POST', body:{...registration,confirm:'mismatch'},status:400 });
  await request('/register', { method:'POST', body:{...registration,confirm:registration.password,role:'admin'} });
  const customer = await login('customer');
  const other = await login('customer', registration.email);
  const staff = await login('staff');
  const admin = await login('admin');
  await request('/items', {status:401});
  await request('/users', {cookie:customer,status:403});
  await request('/dashboard/counts', {cookie:customer,status:403});
  assert.deepEqual((await request('/dashboard/counts', {cookie:staff})).data, {itemCount:3,userCount:2});
  assert.deepEqual((await request('/dashboard/counts', {cookie:admin})).data, {itemCount:3,userCount:4});
  await request('/users', {method:'POST',cookie:staff,body:registration,status:403});

  const item = {name:'Test Gown',category:'Gowns',size:'S',price:100,stock:1,description:'Test garment',condition:'Good'};
  await request('/items',{method:'POST',cookie:staff,body:item});
  const itemId = (await request('/items',{cookie:customer})).data.find(row => row.name===item.name).id;
  const availability = '/items/'+itemId+'/availability?start='+today+'&due='+today;
  const quote = (await request(availability,{cookie:customer})).data;
  assert.deepEqual(quote,{available:1,total:10000});
  const form = {itemId,name:'Demo Customer',address:'Victoria',phone:'09123456789',kind:'Rent',start:today,due:today,method:'Cash on Pickup',total:quote.total};
  const requestBooking = (cookie, body, status=200) => request('/rentals',{method:'POST',cookie,body,status});
  await requestBooking(customer,{...form,total:9999},409);
  assert.deepEqual((await request('/rentals',{cookie:customer})).data,[]);
  const payload = {method:'POST',headers:{Cookie:customer,'Content-Type':'application/json'},body:JSON.stringify(form)};
  const race = await Promise.all([fetch(root+'/rentals',payload),fetch(root+'/rentals',payload)]);
  assert.deepEqual(race.map(res => res.status).sort(),[200,409]);
  const {id} = await race.find(res => res.ok).json();
  await race.find(res => !res.ok).json();
  const change = (id, action, extra={}, status=200) => request('/rentals/'+id,{method:'PATCH',cookie:staff,body:{action,...extra},status});
  await change(id,'release',{},409);
  await change(id,'verify');
  await change(id,'release');
  assert.deepEqual((await request('/rentals',{cookie:other})).data,[]);
  await request('/rentals/'+id,{method:'PATCH',cookie:customer,body:{action:'return'},status:403});
  await change(id,'return',{inspection:'Good condition',penalty:0});
  assert.equal((await request(availability,{cookie:customer})).data.available,1);
  await change(id,'return',{inspection:'Duplicate',penalty:0},409);

  const receipt = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+audsAAAAASUVORK5CYII=';
  const reserve = {...form,kind:'Reserve',start:tomorrow,due:tomorrow,method:'GCash',reference:'TEST-REF',receipt};
  const reserved = (await requestBooking(customer,reserve)).data.id;
  await requestBooking(other,{...reserve,start:afterTomorrow,due:afterTomorrow},409);
  await request('/rentals/'+reserved+'/receipt',{cookie:other,status:404});
  assert.equal((await request('/rentals/'+reserved+'/receipt',{cookie:staff})).data.receipt,receipt);
  await change(reserved,'verify');
  await change(reserved,'reserve');
  assert.equal((await request('/rentals',{cookie:customer})).data[0].displayStatus,'Reserved');
  assert.equal(await stockUsed(itemId,tomorrow,tomorrow),1);

  await request('/messages',{method:'POST',cookie:customer,body:{body:'Can I collect it tomorrow?'}});
  const [message] = (await request('/messages',{cookie:staff})).data;
  await request('/messages',{method:'POST',cookie:staff,body:{userId:message.userId,body:'Yes, during shop hours.'}});
  assert.equal((await request('/messages',{cookie:customer})).data.length,2);
  assert.equal((await request('/messages',{cookie:other})).data.length,0);

  const report = (await request('/reports',{method:'POST',cookie:admin,body:{from:today,to:today,type:'Transactions'}})).data;
  assert.equal(report.transactions,2);
  assert.equal(report.revenue,20000);
  assert.deepEqual(report.top,[['Test Gown',1]]);
  assert.equal((await all('SELECT id FROM reports')).length,1);
  assert.ok((await request('/activity',{cookie:admin})).data.length >= 7);

  // A garment returned late still takes up physical stock until the staff records its return.
  const next = (await requestBooking(customer,{...form,start:afterTomorrow,due:afterTomorrow})).data.id;
  const yesterday = shopDate(Date.now()-86400000);
  await run("UPDATE rentals SET status='Active',start=?,due=? WHERE id=?",yesterday,yesterday,id);
  assert.equal(await stockUsed(itemId,afterTomorrow,afterTomorrow),2);
  assert.ok((await request('/notifications',{cookie:customer})).data.some(entry => entry.text.includes('overdue')));
  assert.ok(next > reserved);
});
