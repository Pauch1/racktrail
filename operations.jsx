import React,{useState} from 'react';
import {api,categories,useData,useAction,submit,readImage,money,dateLabel,Button,Feedback,Field,Title,Table,ItemImage,Upload,AccountFields,PasswordFields} from './ui.jsx';

export function Inventory({version,refresh}) {
  const data = useData('/items',version);
  const [search,setSearch] = useState('');
  const [item,setItem] = useState(null);
  const [state,act] = useAction();
  if (item) return <><Title title={item.id ? 'Item Details' : 'Add New Item'}><Button secondary onClick={() => setItem(null)}>Back to Items</Button></Title>
    <form key={item.id || 'new'} className="panel padded split" onSubmit={submit(act,async body => {
      body.image = await readImage(body.image);
      await api('/items'+(item.id ? '/'+item.id : ''),item.id ? 'PATCH' : 'POST',body);
      refresh(); setItem(null); return 'Item saved.';
    })}><div className="stack"><ItemImage item={item}/><Upload name="image" label="Item Image"/></div>
      <div className="stack"><Field name="name" label="Item Name" defaultValue={item.name}/>
        <Field name="category" label="Category" options={categories} defaultValue={item.category}/>
        <div className="two"><Field name="size" label="Size" defaultValue={item.size}/>
          <Field name="price" label="Daily Price (₱)" type="number" min="0.01" step="0.01" defaultValue={item.id ? item.price/100 : ''}/></div>
        <div className="two"><Field name="stock" label="Stock" type="number" min={0} defaultValue={item.stock}/>
          <Field name="condition" label="Condition" defaultValue={item.condition || 'Good'}/></div>
        <Field name="description" label="Description" multiline defaultValue={item.description}/>
        <Feedback state={state}/><Button type="submit" disabled={state.busy}>{item.id ? 'Save' : 'Add Item'}</Button></div>
    </form></>;
  return <><Title title="Items" caption="Manage clothing rental items."><Button onClick={() => setItem({})}>Add Item</Button></Title>
    <section className="panel padded stack"><Field name="search" label="Search items" type="search" required={false} value={search} onChange={event => setSearch(event.target.value)}/>
      <Feedback state={data}/><Feedback state={state}/>
      <Table key={search} headers={['Item','Category','Size','Price','Stock','Available Today','Action']}
        rows={(data.data || []).filter(row => (row.name+' '+row.category).toLowerCase().includes(search.toLowerCase())).map(row =>
          [row.name,row.category,row.size,money(row.price),row.stock,row.available,<div className="actions">
            <Button secondary onClick={() => setItem(row)}>Edit</Button><Button secondary disabled={state.busy} onClick={() => {
              if (confirm('Remove '+row.name+' from the catalog?')) act(async () => {
                await api('/items/'+row.id,'DELETE'); refresh(); return 'Item removed.';
              });
            }}>Remove</Button></div>])}/>
    </section></>;
}
export function Users({user,version,refresh}) {
  const admin = user.role==='admin';
  const data = useData('/users',version);
  const [search,setSearch] = useState('');
  const [selected,setSelected] = useState(null);
  const [state,act] = useAction();
  const rows = (data.data || []).filter(row => row.name.toLowerCase().includes(search.toLowerCase()));
  return <><Title title={admin ? 'Users' : 'Customers'}>{admin && <Button onClick={() => setSelected({})}>Add User</Button>}</Title>
    <section className="panel padded stack"><Field name="search" label={admin ? 'Search users' : 'Search customer name'} type="search" required={false} value={search} onChange={event => setSearch(event.target.value)}/>
      <Feedback state={data}/><Feedback state={state}/>
      <Table key={search} headers={admin ? ['Name','Email','Contact','Role','Status','Actions'] : ['Customer Name','Contact Number','Email','Address']}
        rows={rows.map(row => admin ? [row.name,row.email,row.phone,row.role,row.active ? 'Active' : 'Inactive',row.id===user.id ? 'Current account' :
          <div className="actions"><Button secondary onClick={() => setSelected(row)}>Edit</Button>
            <Button secondary disabled={state.busy} onClick={() => {
              if (confirm('Delete this account?')) act(async () => {
                await api('/users/'+row.id,'DELETE'); refresh(); setSelected(null); return 'Account deleted.';
              });
            }}>Delete</Button></div>] : [row.name,row.phone,row.email,row.address])}/>
    </section>
    {selected && <form key={selected.id || 'new'} className="panel padded stack transaction-detail" onSubmit={submit(act,async body => {
      await api('/users'+(selected.id ? '/'+selected.id : ''),selected.id ? 'PATCH' : 'POST',{...body,active:body.active==='Active'});
      refresh(); setSelected(null); return 'Account saved.';
    })}>
      <h2>{selected.id ? 'Edit User' : 'Add User'}</h2><AccountFields user={selected}/>
      <div className="two"><Field name="role" label="Role" options={['customer','staff','admin']} defaultValue={selected.role}/>
        {selected.id && <Field name="active" label="Status" options={['Active','Inactive']} defaultValue={selected.active ? 'Active' : 'Inactive'}/>}</div>
      <div className="two"><PasswordFields optional={Boolean(selected.id)}/></div>
      <div className="actions"><Button type="submit" disabled={state.busy}>Save User</Button><Button secondary onClick={() => setSelected(null)}>Cancel</Button></div>
    </form>}
  </>;
}
export function Messages({user,version,refresh}) {
  const customer = user.role==='customer';
  const data = useData('/messages',version);
  const [thread,setThread] = useState(customer ? user.id : null);
  const [state,act] = useAction();
  const all = data.data || [];
  const threads = [...new Map(all.map(row => [row.userId,row.customer]))];
  const messages = all.filter(row => row.userId===thread);
  return <><Title title="Message Us" caption={customer ? 'Contact the shop for questions and assistance.' : 'Read and respond to customer inquiries.'}/>
    <Feedback state={data}/>
    <section className={customer ? 'panel padded message-panel' : 'panel padded message-panel shop-messages'}>
      {!customer && <div className="thread-list"><h2>Customer Messages</h2>
        {threads.length ? threads.map(([id,name]) => <button className={thread===id ? 'chosen plain' : 'plain'} type="button" key={id} onClick={() => setThread(id)}>{name}</button>) : <p>No customer messages yet.</p>}</div>}
      {thread && <div className="conversation"><h2>{customer ? 'RackTrail Staff' : threads.find(([id]) => id===thread)?.[1]}</h2>
        <div className="messages" aria-live="polite">{messages.length ? messages.map(message => <div key={message.id} className={message.senderId===user.id ? 'bubble mine' : 'bubble'}>
          <small>{message.sender} · {dateLabel(message.created)}</small><p>{message.body}</p></div>) : <p className="muted">Send a message to start the conversation.</p>}</div>
        <form className="message-form" onSubmit={submit(act,async ({body},form) => {
          await api('/messages','POST',{userId:thread,body}); form.reset(); refresh();
        })}><Field name="body" label="Message" placeholder="Type your message here…" maxLength={2000}/>
          <Button type="submit" disabled={state.busy}>Send</Button></form><Feedback state={state}/></div>}
    </section></>;
}
