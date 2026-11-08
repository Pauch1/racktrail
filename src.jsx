import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Account, Catalog, Booking, Transactions, Inventory, Users, Messages, Reports, Profile, Settings, Stats, Table, dateLabel, Badge, Button, useData } from './screens.jsx';
import './style.css';

import { api } from './ui.jsx';

const customerNav = ['Dashboard', 'Items', 'My Rent/Reservation', 'History', 'Message'];
const staffNav = ['Dashboard', 'Items', 'Customers', 'Transaction', 'Reports', 'Message', 'Profile'];
const adminNav = ['Dashboard', 'Users', 'Items', 'Reports', 'Settings', 'Profile'];
const publicNav = ['Home', 'About Us', 'FAQs', 'Login'];
const pathFor = page => '#' + encodeURIComponent(page);
const currentPage = () => {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; }
};

function App() {
  const [user, setUser] = useState(undefined);
  const [page, setPage] = useState(currentPage);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const [booking, setBooking] = useState(null);
  const [filter, setFilter] = useState('All');
  const [version, setVersion] = useState(0);
  const [menu, setMenu] = useState(false);
  const [loginRole, setLoginRole] = useState('customer');
  const resetToken = new URLSearchParams(location.search).get('reset');
  const refresh = () => setVersion(value => value + 1);
  const go = (next, keepNotice = false) => {
    if (!keepNotice) setNotice('');
    setMenu(false);
    setPage(next);
    location.hash = pathFor(next);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const change = () => {
      const next = currentPage();
      setPage(next);
      setMenu(false);
      if (next !== 'Login') setLoginRole('customer');
    };
    window.addEventListener('hashchange', change);
    api('/me').then(data => setUser(data.id ? data : null)).catch(error => { setUser(null); setNotice(error.message); });
    return () => window.removeEventListener('hashchange', change);
  }, []);
  async function logout() {
    try {
      await api('/logout', 'POST');
      setUser(null);
      setSelected(null);
      setBooking(null);
      setFilter('All');
      go('Home');
    } catch (error) { setNotice(error.message); }
  }
  if (user === undefined) return <main className="public-content" aria-live="polite">Loading RackTrail…</main>;
  if (!user || resetToken) {
    const view = resetToken ? 'Reset Password' : [...publicNav, 'Create Account', 'Forgot Password'].includes(page) ? page : 'Home';
    const isPublic = publicNav.slice(0, 3).includes(view);
    const home = resetToken ? '/' : '#Home';
    return <>
      <header><a className="brand" href={home} onClick={() => setNotice('')}>RackTrail</a><nav aria-label="Public navigation">
        {isPublic ? publicNav.map(item =>
          <a key={item} className={view === item ? 'chosen' : ''} aria-current={view === item ? 'page' : undefined}
            href={pathFor(item)} onClick={() => setNotice('')}>{item}</a>) :
          <a className={view === 'Login' && loginRole === 'customer' ? 'back-home highlighted' : 'back-home'}
            href={home} onClick={() => setNotice('')}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5m6-6-6 6 6 6"/></svg>
            Back to Home
          </a>}
      </nav></header>
      {notice && <div className="public-content"><p className="notice" role="status">{notice}</p></div>}
      {isPublic ? <Public key={view} page={view} go={go}/> : <Account key={view} page={view} go={go}
        setUser={setUser} setNotice={setNotice} resetToken={resetToken} role={loginRole} setRole={setLoginRole}/>}
    </>;
  }
  const nav = user.role === 'customer' ? customerNav : user.role === 'staff' ? staffNav : adminNav;
  let view = [...nav, 'Notifications', 'Profile', 'Settings', 'Item Details', 'Rent Form', 'Payment Method', ...(user.role === 'admin' ? ['Transaction', 'Message'] : [])].includes(page) ? page : 'Dashboard';
  if ((view === 'Item Details' && !selected) || (['Rent Form', 'Payment Method'].includes(view) && !booking)) view = 'Items';
  if (view === 'Payment Method' && !booking.start) view = 'Rent Form';
  const startBooking = (item, kind) => {
    setBooking({ item, kind, name: user.name, address: user.address, phone: user.phone });
    go('Rent Form');
  };
  const showItem = item => { setSelected(item); go('Item Details'); };
  const screen = {
    Dashboard: <Dashboard user={user} version={version} filter={filter} setFilter={setFilter} go={go}/>,
    Items: user.role === 'customer' ? <Catalog version={version} refresh={refresh} showItem={showItem} startBooking={startBooking}/> : <Inventory version={version} refresh={refresh}/>,
    'Item Details': <Catalog selected={selected} startBooking={startBooking} back={() => go('Items')}/>,
    'Rent Form': <Booking booking={booking} setBooking={setBooking} go={go}/>,
    'Payment Method': <Booking payment booking={booking} setBooking={setBooking} go={go} refresh={refresh} setNotice={setNotice}/>,
    'My Rent/Reservation': <Transactions user={user} version={version} title="My Rent/Reservation"/>,
    History: <Transactions user={user} version={version} title="History"/>,
    Transaction: <Transactions user={user} version={version} refresh={refresh} title="Rental Transactions"/>,
    Customers: <Users user={user} version={version} refresh={refresh}/>,
    Users: <Users user={user} version={version} refresh={refresh}/>,
    Message: <Messages user={user} version={version} refresh={refresh}/>,
    Reports: <Reports/>,
    Profile: <Profile user={user} setUser={setUser} go={go}/>,
    Settings: <Settings user={user} setUser={setUser} go={go}/>,
    Notifications: <Notifications version={version}/>
  }[view];
  return <>
    <header className="portal-header">
      <div className="header-left"><button type="button" className="plain mobile-menu" aria-expanded={menu} aria-controls="sidebar" onClick={() => setMenu(!menu)}>Menu</button><a className="brand" href="#Dashboard">RackTrail</a></div>
      <nav aria-label="Account"><Badge>{user.role === 'admin' ? 'Admin' : user.role === 'staff' ? 'Staff' : 'Customer'}</Badge>
        <a href="#Notifications">Notifications</a><details key={view}><summary>My Account
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </summary><div className="account-menu"><a href="#Profile">Profile</a><a href="#Settings">Settings</a><button type="button" className="plain" onClick={logout}>Logout</button></div></details>
      </nav>
    </header>
    <div className="portal">
      <aside id="sidebar" className={menu ? 'open' : ''}><a className="brand" href="#Dashboard">RackTrail</a>
        <nav aria-label="Portal navigation">{nav.map(item => <a key={item} aria-current={view === item ? 'page' : undefined} className={view === item ? 'chosen' : ''} href={pathFor(item)} onClick={() => { setMenu(false); setNotice(''); }}>{item}</a>)}
          <button className="plain logout" type="button" onClick={logout}>Logout</button>
        </nav>
      </aside>
      <main className="workspace" key={view}>
        {notice && <p className="notice" role="status">{notice}</p>}
        {screen}
      </main>
    </div>
  </>;
}

function Public({ page, go }) {
  if (page === 'About Us') return <main className="public-content public-info">
    <h1>About RackTrail</h1><p>RackTrail helps customers browse, rent, and reserve clothing from Bebeth’s Tailor Shop in Victoria, Oriental Mindoro.</p>
    <div className="three">{[['Our Mission', 'Make clothing rentals easy and organized for both customers and shop staff.'], ['What We Offer', 'Browse available outfits, rent or reserve items, and track your transactions.'], ['Designed for Customers', 'Choose your dates and payment method, then follow your request online.']].map(([title, copy]) => <article className="panel feature" key={title}><strong>{title}</strong><p>{copy}</p></article>)}</div>
  </main>;
  if (page === 'FAQs') return <main className="public-content public-info">
    <h1>Frequently Asked Questions</h1>
    {[
      ['How do I rent an item?', 'Browse the catalog, select an item, and complete the rent form with your preferred dates.'],
      ['What is the difference between Rent and Reserve?', 'Choose Rent to request an outfit, or Reserve to hold an item for a future date once the shop confirms it.'],
      ['What payment methods are accepted?', 'Choose Cash on Pickup or GCash when enabled by the shop.'],
      ['How do I check my rental status?', 'Open My Rent/Reservation to check booking and payment updates.'],
      ['Can I cancel a reservation?', 'Contact the shop through Message Us to discuss changes to your booking.']
    ].map(([title, copy]) => <article className="panel feature faq" key={title}><strong>{title}</strong><p>{copy}</p></article>)}
  </main>;
  return <main className="public-content">
    <section className="hero panel"><div><div className="eyebrow">Clothing Rental &amp; Reservation System</div>
      <h1>RackTrail</h1><p>Rental clothes for your next event. Browse available items, rent or reserve, choose your payment method, and track your transactions in one place.</p>
      <Button onClick={() => go('Login')}>Get Started</Button></div>
      <div className="hero-photo"><img src="/rack.webp" alt="Colorful formal outfits on a clothing rack" fetchPriority="high"/></div>
    </section>
    <div className="three">{[['Rent Clothes', 'View clothing details and submit a rental form.'], ['Reserve Items', 'Reserve an available clothing item for your preferred date.'], ['Track Transactions', 'View current rentals, reservations, history, and receipts.']].map(([title, copy]) => <article className="panel feature" key={title}><strong>{title}</strong><p>{copy}</p></article>)}</div>
  </main>;
}

function Dashboard({ user, version, filter, setFilter, go }) {
  const customer = user.role === 'customer';
  const admin = user.role === 'admin';
  const rentals = useData('/rentals', version);
  const counts = useData(customer ? null : '/dashboard/counts', version);
  const activity = useData(admin ? '/activity' : null, version);
  const rows = rentals.data || [];
  return <>
    <div className="title-row"><div><h1>{customer ? 'Customer Dashboard' : admin ? 'Welcome, Admin!' : 'Good Day, Staff!'}</h1>
      <p>{customer ? 'Monitor and manage your rental activities.' : admin ? 'Overview of the RackTrail system.' : 'Customer rental monitoring dashboard.'}</p></div>
      <Button onClick={() => go('Items')}>{customer ? 'Browse Items' : 'Add / View Items'}</Button>
    </div>
    {((!customer && rentals.error) || counts.error || activity.error) && <p className="error" role="alert">{rentals.error || counts.error || activity.error}</p>}
    <Stats entries={customer ? [
      ['Total Rentals', rentals.data ? rows.length : '—'], ['Active Rentals', rentals.data ? rows.filter(row => row.displayStatus === 'Active').length : '—'],
      ['Reservations', rentals.data ? rows.filter(row => row.status === 'Reserved').length : '—'], ['Completed', rentals.data ? rows.filter(row => row.status === 'Returned').length : '—']
    ] : admin ? [
      ['Total Users', counts.data?.userCount ?? '—'], ['Total Items', counts.data?.itemCount ?? '—'],
      ['Total Rentals', rentals.data ? rows.length : '—'], ['Recent Activity', activity.data?.length ?? '—']
    ] : [
      ['Total Items', counts.data?.itemCount ?? '—'], ['Total Customers', counts.data?.userCount ?? '—'],
      ['Total Rent', rentals.data ? rows.length : '—'], ['Rent Overdue', rentals.data ? rows.filter(row => row.displayStatus === 'Overdue').length : '—']
    ]}/>
    {admin ? <section className="panel padded"><h2>Recent Activity</h2><Table headers={['Activity', 'User', 'Date']} rows={(activity.data || []).map(entry => [entry.event, entry.actor, dateLabel(entry.created)])}/></section>
      : customer ? <Transactions user={user} rentalData={rentals} title="Recent Rentals" embedded filter={filter} setFilter={setFilter}/>
        : <section className="panel padded"><h2>Customers</h2><Table headers={['Customer Name', 'Item', 'Due Date', 'Status']} rows={rows.slice(0, 8).map(row => [row.name, row.itemName, dateLabel(row.due), <Badge>{row.displayStatus}</Badge>])}/></section>}
    {admin && <div className="toolbar"><Button secondary onClick={() => go('Transaction')}>Rental Transactions</Button><Button secondary onClick={() => go('Message')}>Customer Messages</Button></div>}
  </>;
}

function Notifications({ version }) {
  const data = useData('/notifications', version);
  return <><h1>Notifications</h1><section className="panel padded">
    {data.error ? <p role="alert" className="error">{data.error}</p> : !data.data ? <p>Loading…</p> : data.data.length ?
      <ul>{data.data.map(item => <li key={item.id}>{item.text}</li>)}</ul> : <p>No notifications.</p>}
  </section></>;
}

createRoot(document.getElementById('root')).render(<App/>);
