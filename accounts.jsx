import React from 'react';
import {api, useAction, submit, Button, Badge, Feedback, Field, Title, AccountFields, PasswordFields} from './ui.jsx';

export function Account({page,go,setUser,setNotice,resetToken,role,setRole}) {
  const [state,act] = useAction();
  const login = page === 'Login';
  const register = page === 'Create Account';
  const forgot = page === 'Forgot Password';
  const title = login ? role[0].toUpperCase() + role.slice(1) + ' Login' : forgot ? 'Forgot Password?' : page;
  return <main className="auth"><form className="panel padded stack" onSubmit={submit(act,async body => {
    if (login) {
      setUser(await api('/login','POST',{...body,role}));
      go('Dashboard');
    } else if (register) {
      await api('/register','POST',body);
      setNotice('Account created. Log in to continue.');
      go('Login',true);
    } else if (forgot) {
      await api('/forgot','POST',body);
      return 'If this address has a RackTrail account, check your inbox for the reset link.';
    } else {
      await api('/reset','POST',{...body,token:resetToken});
      history.replaceState(null,'','/#Login');
      setUser(null);
      setNotice('Password updated. Log in with your new password.');
      go('Login',true);
    }
  })}>
    <h1>{title}</h1>
    {forgot && <p>Enter your email address to receive a password reset link.</p>}
    {register ? <AccountFields/> : (login || forgot) && <Field name="email" label={login ? 'Username / Email' : 'Email'} type="email" autoComplete="email" placeholder="Enter your email"/>}
    {login && <Field name="password" label="Password" type="password" autoComplete="current-password" placeholder="Enter password" maxLength={128}/>}
    {!login && !forgot && <PasswordFields/>}
    <Feedback state={state}/>
    <Button type="submit" disabled={state.busy}>{login ? 'Log In' : register ? 'Register' : forgot ? 'Send Reset Link' : 'Update Password'}</Button>
    {login ? <><div className="auth-links"><a href="#Create%20Account">Register</a><a href="#Forgot%20Password">Forgot Password?</a></div>
      <div className="role-tabs"><span>Login as</span>{['customer','staff','admin'].map(option => <button key={option} type="button" aria-pressed={role===option}
        className={role===option ? 'chosen' : ''} onClick={() => setRole(option)}>{option}</button>)}</div></> :
      <a className="center" href={resetToken ? '/#Login' : '#Login'}>Back to Login</a>}
  </form></main>;
}

function Tabs({go,settings}) {
  return <div className="toolbar"><Button secondary={settings} onClick={() => go('Profile')}>Edit Profile</Button>
    <Button secondary={!settings} onClick={() => go('Settings')}>Settings</Button></div>;
}
export function Profile({user,setUser,go}) {
  const [state,act] = useAction();
  return <><Title title="Profile"/><Tabs go={go}/><div className="profile-layout">
    <div className="panel padded profile-summary"><div className="avatar">{user.name[0].toUpperCase()}</div><h2>{user.name}</h2>
      <p className="muted">{user.email}</p><Badge>{user.role}</Badge></div>
    <form className="panel padded stack" onSubmit={submit(act,async (body,form) => {
      setUser(await api('/profile','PATCH',body));
      form.elements['current password'].value = '';
      return 'Profile saved.';
    })}><h2>Edit Profile</h2><AccountFields user={user}/>
      <Field name="current password" label="Current Password (required to change email)" type="password" required={false} autoComplete="current-password"/>
      <Feedback state={state}/><Button type="submit" disabled={state.busy}>Save Changes</Button></form>
  </div></>;
}
export function Settings({user,setUser,go}) {
  const [password,changePassword] = useAction();
  const [settings,changeSettings] = useAction();
  return <><Title title="Settings"/><Tabs go={go} settings/><div className="two">
    <form className="panel padded stack" onSubmit={submit(changePassword,async (body,form) => {
      await api('/password','PATCH',body); form.reset(); return 'Password updated.';
    })}><h2>Change Password</h2><Field name="current password" label="Current Password" type="password" autoComplete="current-password"/>
      <PasswordFields/><Feedback state={password}/><Button type="submit" disabled={password.busy}>Update Password</Button></form>
    <form className="panel padded stack" onSubmit={submit(changeSettings,async body => {
      setUser(await api('/settings','PATCH',{reminders:body.reminders==='on'})); return 'Notification settings saved.';
    })}><h2>Notification Settings</h2><label className="check"><input type="checkbox" name="reminders" defaultChecked={Boolean(user.reminders)}/>
      In-app payment updates and due-date reminders</label><Feedback state={settings}/><Button type="submit" disabled={settings.busy}>Save Settings</Button></form>
  </div></>;
}
