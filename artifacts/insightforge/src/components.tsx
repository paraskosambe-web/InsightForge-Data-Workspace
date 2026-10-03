import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, BarChart3, BrainCircuit, ChevronDown, CircleHelp, Database, FileChartColumn, FlaskConical, Gauge, Menu, MessageSquareText, Search, Settings, ShieldCheck, Sparkles, UserRound, X, Bell, PanelLeftClose, PanelLeftOpen, Upload, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@workspace/replit-auth-web';

const nav: [string,string,LucideIcon][] = [
  ['Overview','/',Gauge],['Datasets','/datasets',Database],['Data Profiling','/profiling',ShieldCheck],
  ['Exploratory Analysis','/exploratory-analysis',BarChart3],['Statistics','/statistics',Activity],['ML Lab','/ml-lab',BrainCircuit],
  ['Model Explainability','/explainability',Sparkles],['Experiments','/experiments',FlaskConical],['AI Data Analyst','/ai-analyst',MessageSquareText],['Reports','/reports',FileChartColumn],
];
export function Shell({ children, title }: {children:ReactNode; title:string}) {
  const auth = useAuth();
  const [loc] = useLocation();
  const [collapsed,setCollapsed] = useState(false);
  const [mobile,setMobile] = useState(false);
  const [notice,setNotice] = useState(false);
  const [toast,setToast] = useState('');
  const flash=(s:string)=>{setToast(s);window.setTimeout(()=>setToast(''),2600)};
  const fullName=[auth.user?.firstName,auth.user?.lastName].filter(Boolean).join(' ')||'Your account';
  const initials=fullName.split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase();
  return <div className="app-shell">
    {mobile&&<button aria-label="Close navigation" className="mobile-scrim" onClick={()=>setMobile(false)} />}
    <aside className={`sidebar ${collapsed?'collapsed':''} ${mobile?'mobile-open':''}`}>
      <Link href="/" className="brand"><span className="brand-mark"><Activity size={19}/></span>{!collapsed&&<span>insight<span className="brand-strong">forge</span><small>DECISION INTELLIGENCE</small></span>}</Link>
      <button onClick={()=>setCollapsed(!collapsed)} className="collapse-btn" aria-label="Collapse sidebar" data-testid="button-collapse-sidebar">{collapsed?<PanelLeftOpen size={17}/>:<PanelLeftClose size={17}/>}</button>
      {!collapsed&&<div className="workspace-switch"><span className="workspace-dot">P</span><span><b>Personal workspace</b><small>Free plan</small></span><ChevronDown size={15}/></div>}
      <div className="nav-label">{!collapsed&&'WORKSPACE'}</div>
      <nav>{nav.map(([label,path,Icon])=><Link key={path} href={path} title={collapsed?label:undefined} className={`nav-item ${loc===path?'active':''}`} onClick={()=>setMobile(false)} data-testid={`link-nav-${path.replaceAll('/','')||'overview'}`}><Icon size={18}/>{!collapsed&&<span>{label}</span>}{path==='/ai-analyst'&&!collapsed&&<i className="nav-new">NEW</i>}</Link>)}</nav>
      <div className="sidebar-bottom">
        {!collapsed&&<div className="help-card"><div className="help-icon"><CircleHelp size={16}/></div><b>New to InsightForge?</b><p>Explore a guided tour of your workspace.</p><Link href="/help" className="help-link">Explore guide <span>→</span></Link></div>}
        <Link href="/settings" className={`nav-item ${loc==='/settings'?'active':''}`}><Settings size={18}/>{!collapsed&&<span>Settings</span>}</Link>
        <Link href="/help" className={`nav-item ${loc==='/help'?'active':''}`}><CircleHelp size={18}/>{!collapsed&&<span>Help & support</span>}</Link>
       <button className="user-control" onClick={auth.logout} title="Sign out" data-testid="button-profile"><span className="avatar">{initials}</span>{!collapsed&&<span><b>{fullName}</b><small>{auth.user?.email ?? 'Signed in with Replit'}</small></span>}{!collapsed&&<ChevronDown size={15}/>}</button>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu" onClick={()=>setMobile(true)} aria-label="Open navigation"><Menu size={20}/></button>
         <div className="crumb">Personal workspace <span>/</span> <b>{title}</b></div>
         <div className="top-actions"><button className="search-trigger" onClick={()=>flash('Search is available from the datasets and experiments pages')}><Search size={16}/><span>Search</span><kbd>⌘ K</kbd></button><button className="icon-button notification" aria-label="Notifications" onClick={()=>setNotice(!notice)}><Bell size={18}/></button><span className="top-avatar">{initials}</span></div>
      </header>
      {notice&&<div className="notice-pop">No new notifications <button onClick={()=>setNotice(false)}><X size={14}/></button></div>}
      <section className="page-content">{children}</section>
    </main>
    {toast&&<div className="toast-message" role="status">{toast}</div>}
  </div>;
}
export function PageTitle({eyebrow,title,subtitle,action}:{eyebrow?:string;title:string;subtitle?:string;action?:ReactNode}) {
 return <div className="page-heading"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{action&&<div className="heading-action">{action}</div>}</div>
}
export function Button({children,onClick,variant='primary',icon}:{children:ReactNode;onClick?:()=>void;variant?:'primary'|'secondary'|'quiet';icon?:ReactNode}) {
 return <button onClick={onClick} className={`btn ${variant}`} data-testid={`button-${String(children).toLowerCase().replace(/[^a-z0-9]+/g,'-')}`}>{icon}{children}</button>
}
export function Card({children,className='',id}:{children:ReactNode;className?:string;id?:string}) { return <section id={id} className={`panel ${className}`}>{children}</section> }
export function SectionHead({title,sub,action}:{title:string;sub?:string;action?:ReactNode}) { return <div className="section-head"><div><h2>{title}</h2>{sub&&<p>{sub}</p>}</div>{action}</div> }