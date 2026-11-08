import React,{useState} from 'react';
import {api,categories,today,money,useData,useAction,submit,readImage,Title,Field,Upload,Button,Badge,Feedback,Filters,ItemImage} from './ui.jsx';

export function Catalog({version,refresh,showItem,startBooking,selected,back}) {
  const state = useData(selected ? null : '/items',version);
  const [search,setSearch] = useState('');
  const [category,setCategory] = useState('All');
  function actions(item,showView) {
    return <div className="actions">{showView && <Button secondary onClick={() => showItem(item)}>View</Button>}
      <Button disabled={!item.stock} onClick={() => startBooking(item,'Rent')}>Rent</Button>
      <Button secondary disabled={!item.stock} onClick={() => startBooking(item,'Reserve')}>Reserve</Button></div>;
  }
  if (selected) return <><Title title="Item Details"><Button secondary onClick={back}>Back to Items</Button></Title>
    <section className="panel padded split"><ItemImage item={selected}/><div><h2>{selected.name}</h2><p className="muted">{selected.description}</p>
      <dl className="details">{Object.entries({Category:selected.category,Size:selected.size,Price:money(selected.price)+' / day',
        Condition:selected.condition,'Available Today':selected.available}).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {actions(selected,false)}</div></section></>;
  const items = (state.data || []).filter(item => (category==='All' || item.category===category) && item.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <><Title title="Rental Items" caption="Choose an outfit for your next occasion."><Button onClick={refresh}>Refresh</Button></Title>
    <Field name="search" label="Search clothing" type="search" placeholder="Search clothing…" value={search} required={false} onChange={event => setSearch(event.target.value)}/>
    <Filters options={['All',...categories]} value={category} onChange={setCategory}/><Feedback state={state}/>
    {state.data ? !items.length && <p className="empty">No items match your search.</p> : !state.error && <p>Loading items…</p>}
    <div className="catalog">{items.map(item => <article className="panel item-card" key={item.id}><ItemImage item={item}/>
      <div className="card-info"><h2>{item.name}</h2><p>{item.category} · Size {item.size}</p>
        <div className="price-line"><span><strong>{money(item.price)}</strong> / day</span><Badge>{item.available} available today</Badge></div>
        {actions(item,true)}</div></article>)}</div></>;
}
export function Booking({booking,setBooking,payment,go,refresh,setNotice}) {
  const [state,act] = useAction();
  const [method,setMethod] = useState('Cash on Pickup');
  const config = useData(payment ? '/payment-config' : null);
  const {item,kind} = booking;
  const days = payment ? (Date.parse(booking.due)-Date.parse(booking.start))/86400000+1 : 0;
  const qr = config.data?.qr;
  if (payment) return <><Title title="Payment Method"><Button secondary onClick={() => go('Rent Form')}>Back to Form</Button></Title>
    <form className="panel padded stack payment" onSubmit={submit(act,async body => {
      const {id} = await api('/rentals','POST',{...booking,item:undefined,itemId:item.id,method,reference:body.reference,receipt:await readImage(body.receipt)});
      setNotice((kind==='Reserve' ? 'Reservation' : 'Rental') + ' request #' + id + ' submitted. Track its status below.');
      setBooking(null); refresh(); go('My Rent/Reservation',true);
    })}><h2>Choose Payment Method</h2><p>{item.name} · {days} {days===1 ? 'day' : 'days'} · <strong>{money(booking.total)}</strong></p>
      <fieldset><legend>Payment method</legend>{['Cash on Pickup','GCash'].map(option => <label className="check" key={option}>
        <input type="radio" name="method" checked={method===option} onChange={() => setMethod(option)} disabled={option==='GCash' && !qr}/>{option}</label>)}</fieldset>
      {config.data && !qr && <p className="muted">GCash is unavailable until the shop configures its payment QR.</p>}
      {method==='GCash' && <><div className="qr"><img src={qr} alt="Shop GCash payment QR code"/><p>Scan the shop’s GCash QR code.</p></div>
        <Field name="reference" label="GCash Reference Number" maxLength={40}/><Upload name="receipt" label="Upload Receipt" required/></>}
      <Feedback state={config}/><Feedback state={state}/><Button type="submit" disabled={state.busy}>Confirm Payment Method</Button>
    </form></>;
  return <><Title title={kind==='Reserve' ? 'Reservation Form' : 'Rent Form'}><Button secondary onClick={() => go('Items')}>Back to Items</Button></Title>
    <section className="panel padded split"><div><ItemImage item={item}/><h2>{item.name}</h2><p className="muted">{money(item.price)} / day · Size {item.size}</p></div>
      <form className="stack" onSubmit={submit(act,async body => {
        const params = new URLSearchParams({start:body.start,due:body.due});
        const {available,total} = await api('/items/'+item.id+'/availability?'+params);
        if (!available) throw new Error('This item is fully booked for those dates.');
        setBooking({...booking,...body,total}); go('Payment Method');
      })}><Field name="name" label="Full Name" defaultValue={booking.name}/>
        <Field name="address" label="Address" defaultValue={booking.address}/>
        <div className="two"><Field name="start" type="date" label={kind==='Reserve' ? 'Reservation Date' : 'Rent Date'} min={today(kind==='Reserve' ? 1 : 0)} defaultValue={booking.start}/>
          <Field name="due" type="date" label="Return Date" min={today()} defaultValue={booking.due}/></div>
        <Field name="phone" label="Contact Number" type="tel" defaultValue={booking.phone}/>
        <Field name="message" label="Message / Special Request" multiline required={false} defaultValue={booking.message}/>
        <Feedback state={state}/><Button type="submit" disabled={state.busy}>Proceed to Payment</Button></form></section></>;
}
