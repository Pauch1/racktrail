import React, {useEffect,useId,useState} from 'react';

export async function api(path, method = 'GET', body = {}) {
  const response = await fetch('/api' + path, method === 'GET' ? {} : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
export const categories = ['Gowns','Suits','Dresses','Skirts','Barongs','Blouses','Accessories'];
const shopCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
});
const pesos = new Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP',minimumFractionDigits:0});
const pesosWithCents = new Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'});
const displayDate = new Intl.DateTimeFormat('en-PH', {
  timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric'
});
export const today = (offset = 0) => shopCalendar.format(Date.now() + offset * 86400000);
export const money = cents => (cents % 100 ? pesosWithCents : pesos).format(cents / 100);
export const dateLabel = value => displayDate.format(new Date(value));
export function useData(path, version = 0) {
  const [state,setState] = useState({});
  useEffect(() => {
    if (!path) return;
    let live = true;
    api(path).then(data => live && setState({data})).catch(error => live && setState({error:error.message}));
    return () => { live = false; };
  },[path,version]);
  return state;
}
export function useAction() {
  const [state,setState] = useState({});
  async function act(work) {
    setState({busy:true});
    try { setState({message:await work()}); }
    catch (error) { setState({error:error.message}); }
  }
  return [state,act];
}
export function submit(act, work) {
  return event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    act(() => work(body, form));
  };
}
export function readImage(file) {
  if (!file?.size) return undefined;
  if (file.size > 2_000_000) throw new Error('Choose an image up to 2 MB.');
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}
export function Button({children,secondary,type='button',...props}) {
  return <button type={type} className={secondary ? 'button secondary' : 'button'} {...props}>{children}</button>;
}
export function Badge({children}) { return <span className="badge">{children}</span>; }
export function Feedback({state}) {
  if (state.error) return <p className="error" role="alert">{state.error}</p>;
  if (state.message) return <p className="notice" role="status">{state.message}</p>;
}
export function Field({label,name,options,multiline,required=true,...props}) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>{options ? <select id={id} name={name} required={required} {...props}>
    {options.map(option => <option key={option}>{option}</option>)}</select> : multiline ?
    <textarea id={id} name={name} required={required} {...props}/> : <input id={id} name={name} required={required} {...props}/>}</div>;
}
export function Upload({name,label,required=false}) {
  return <Field type="file" name={name} label={label} required={required} accept="image/png,image/jpeg,image/webp"/>;
}
export function Title({title,caption,children}) {
  return <div className="title-row"><div><h1>{title}</h1>{caption && <p>{caption}</p>}</div>{children}</div>;
}
export function Stats({entries}) {
  return <div className="stats">{entries.map(([label,value]) => <div className="panel stat" key={label}>{label}<strong>{value}</strong></div>)}</div>;
}
export function Table({headers,rows,paginate=true,empty='No records to display.'}) {
  const [page,setPage] = useState(0);
  const count = paginate ? Math.max(1, Math.ceil(rows.length / 8)) : 1;
  const index = Math.min(page,count-1);
  const visible = paginate ? rows.slice(index*8,index*8+8) : rows;
  return <><div className="table-wrap"><table><thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{visible.length ? visible.map((row,i) => <tr key={i}>{row.map((cell,j) => <td key={j}>{cell}</td>)}</tr>) :
      <tr><td colSpan={headers.length} className="empty">{empty}</td></tr>}</tbody></table></div>
    {count > 1 && <div className="pagination"><Button secondary disabled={index===0} onClick={() => setPage(index-1)}>Previous</Button>
      <span>Page {index+1} of {count}</span><Button secondary disabled={index===count-1} onClick={() => setPage(index+1)}>Next</Button></div>}</>;
}
export function Filters({options,value,onChange}) {
  return <div className="filters">{options.map(option => <button key={option} type="button" aria-pressed={value===option} onClick={() => onChange(option)}>{option}</button>)}</div>;
}
export function ItemImage({item}) {
  return item.image ? <img className="item-image" src={item.image} alt={item.name}/> : <div className="image-placeholder">No item photo</div>;
}
export function AccountFields({user={}}) {
  return <div className="two"><Field name="name" label="Full Name" defaultValue={user.name} autoComplete="name"/>
    <Field name="phone" label="Contact Number" defaultValue={user.phone} type="tel" required={false} autoComplete="tel"/>
    <Field name="email" label="Email" defaultValue={user.email} type="email" autoComplete="email"/>
    <Field name="address" label="Address" defaultValue={user.address} autoComplete="street-address"/></div>;
}
export function PasswordFields({optional=false}) {
  return <><Field name="password" label={optional ? 'New Password (optional)' : 'Password'} type="password" autoComplete="new-password" minLength={8} maxLength={128} required={!optional}/>
    <Field name="confirm" label="Confirm Password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required={!optional}/></>;
}
