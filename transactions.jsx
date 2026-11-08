import React,{useState} from 'react';
import {api,useData,useAction,submit,money,dateLabel,today,Button,Badge,Feedback,Field,Title,Stats,Table,Filters} from './ui.jsx';
export function Transactions({user,version,refresh,title,embedded,filter,setFilter,rentalData}) {
  const localData = useData(rentalData ? null : '/rentals',version);
  const data = rentalData ?? localData;
  const [localFilter,setLocalFilter] = useState('All');
  const [search,setSearch] = useState('');
  const [selected,setSelected] = useState(null);
  const [state,act] = useAction();
  const [receipt,setReceipt] = useState(null);
  const shop = user.role!=='customer';
  const status = filter ?? localFilter;
  const history = title==='History';
  const openOnly = title==='My Rent/Reservation';
  const rows = (data.data || []).filter(row => {
    const closed = ['Returned','Rejected'].includes(row.status);
    return (!history || closed) && (!openOnly || !closed) && (status==='All' || row.displayStatus===status) &&
      (row.name+' '+row.itemName+' '+row.id).toLowerCase().includes(search.toLowerCase());
  });
  const row = data.data?.find(item => item.id===selected);
  const show = id => { setSelected(id); setReceipt(null); };
  const detailButton = row => <Button secondary onClick={() => show(row.id)}>{shop ? 'View' : 'View Details'}</Button>;
  function update(action,body={}) {
    return async () => {
      await api('/rentals/'+row.id,'PATCH',{action,...body});
      refresh();
      return 'Transaction updated.';
    };
  }
  const open = row && ['Pending','Reserved'].includes(row.status);
  const pendingPayment = open && row.payment==='Pending';
  const gcash = row?.method==='GCash';
  return <>{!embedded && <Title title={title} caption={shop ? 'Monitor customer rental and payment records.' : 'View your rental and reservation records.'}/>}
    <section className="panel padded">
      {embedded && <h2>{title}</h2>}
      {shop && <Field name="search" label="Search transactions" type="search" required={false} value={search} onChange={event => setSearch(event.target.value)}/>}
      {!history && <Filters options={['All','Pending','Active','Reserved','Overdue',...(!openOnly ? ['Returned','Rejected'] : [])]} value={status} onChange={setFilter || setLocalFilter}/>}
      <Feedback state={data}/>
      <Table key={status+search} headers={shop ? ['Date','Customer','Item','Amount','Payment','Status','Action'] :
        ['Transaction ID','Item','Rent/Reservation','Dates','Price','Status','Action']}
        empty={data.data ? 'No transactions to display.' : 'Loading transactions…'}
        rows={rows.map(item => shop ? [dateLabel(item.created),item.name,item.itemName,money(item.total),item.method+' · '+item.payment,
          <Badge>{item.displayStatus}</Badge>,detailButton(item)] :
          ['#'+item.id,item.itemName,item.kind,dateLabel(item.start)+' – '+dateLabel(item.due),money(item.total),
          <Badge>{item.displayStatus}</Badge>,detailButton(item)])}/>
    </section>
    {row && <section className="panel padded transaction-detail" key={row.id}>
      <div className="title-row"><h2>Transaction #{row.id} · {row.itemName}</h2><Button secondary onClick={() => show(null)}>Close</Button></div>
      <div className="actions"><Badge>{row.displayStatus}</Badge><Badge>{row.payment}</Badge></div>
      <p>{row.kind} · {dateLabel(row.start)} – {dateLabel(row.due)} · {money(row.total)} · {row.method}</p>
      <p>{row.name} · {row.phone} · {row.address}</p>
      {row.message && <p className="message-text">{row.message}</p>}{row.reference && <p>GCash reference: {row.reference}</p>}
      {row.returned && <p>Returned {dateLabel(row.returned)} · {row.inspection} · Penalty {money(row.penalty)}</p>}
      {row.hasReceipt && <Button secondary disabled={state.busy} onClick={() => act(async () => {
        const {receipt: image} = await api('/rentals/'+row.id+'/receipt');
        setReceipt({rentalId:row.id,image});
      })}>View Receipt</Button>}
      {receipt?.rentalId===row.id && <img className="receipt" src={receipt.image} alt="Uploaded GCash receipt"/>}
      <Feedback state={state}/>
      {shop && <div className="actions">
        {pendingPayment && <Button disabled={state.busy} onClick={() => act(update('verify'))}>{gcash ? 'Verify Payment' : 'Record Cash Payment'}</Button>}
        {pendingPayment && <Button secondary disabled={state.busy} onClick={() => {
          if (confirm(gcash ? 'Reject payment and close this booking?' : 'Reject this booking?')) act(update(gcash ? 'reject-payment' : 'reject'));
        }}>{gcash ? 'Reject Payment' : 'Reject Booking'}</Button>}
        {open && row.status==='Pending' && row.kind==='Reserve' && (!gcash || row.payment==='Verified') &&
          <Button secondary disabled={state.busy} onClick={() => act(update('reserve'))}>Confirm Reservation</Button>}
        {open && row.payment==='Verified' && <Button disabled={state.busy} onClick={() => act(update('release'))}>Release Item</Button>}
      </div>}
      {shop && row.status==='Active' && <form className="stack return-form" onSubmit={submit(act,body => update('return',body)())}>
        <Field name="inspection" label="Return Inspection" multiline maxLength={1000}/>
        <Field name="penalty" label="Penalty (₱)" type="number" min={0} step="0.01" defaultValue={0}/>
        <Button type="submit" disabled={state.busy}>Mark Returned</Button></form>}
    </section>}
  </>;
}

export function Reports() {
  const [report,setReport] = useState(null);
  const [state,act] = useAction();
  return <><Title title="Reports">{report && <Button onClick={() => window.print()}>Print / Save PDF</Button>}</Title>
    <div className="two report-summary"><section className="panel padded"><h2>Transaction Reports</h2>
      <Stats entries={ [['Transactions',report?.transactions ?? '—'],['Revenue',report ? money(report.revenue) : '—'],
        ['Items Rented',report?.rented ?? '—'],['Overdue',report?.overdue ?? '—']] }/></section>
      <section className="panel padded"><h2>Top Rented Items</h2><Table headers={['Rank','Item','Times Rented']} paginate={false}
        rows={(report?.top || []).map(([name,count],index) => [index+1,name,count])}/></section></div>
    <form className="panel padded stack report-form" onSubmit={submit(act,async body => {
      setReport(await api('/reports','POST',body));
    })}><h2>Generate Report</h2><div className="three">
      <Field name="from" label="From" type="date" defaultValue={today().slice(0,7)+'-01'}/>
      <Field name="to" label="To" type="date" defaultValue={today()}/>
      <Field name="type" label="Report Type" options={['Transactions','Payments','Inventory']}/></div>
      <Feedback state={state}/><Button type="submit" disabled={state.busy}>Generate Report</Button></form>
    {report && <section className="panel padded"><h2>{report.type} · {dateLabel(report.from)} – {dateLabel(report.to)}</h2>
      {report.type==='Inventory' ? <Table headers={['Item','Category','Stock','Condition']} paginate={false}
        rows={report.inventory.map(row => [row.name,row.category,row.stock,row.condition])}/> :
        <Table headers={['Date','Customer','Item','Amount','Payment','Status']} paginate={false}
          rows={report.rows.map(row => [dateLabel(report.type==='Payments' ? row.paidAt || row.created : row.created),row.name,row.itemName,
            money(row.total),row.method+' · '+row.payment,row.displayStatus])}/>}
    </section>}
  </>;
}
