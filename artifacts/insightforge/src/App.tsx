import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Activity, ShieldCheck } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { Shell } from './components';
import { WorkspaceProvider } from './lib/workspace';
import { Analyst, Datasets, EDA, Explainability, Experiments, HelpPage, MLLab, Overview, Profiling, Reports, SettingsPage, Statistics } from './live-pages';

function App() {
  const auth = useAuth();
  if (auth.isLoading) {
    return <div className="auth-screen"><div className="auth-card"><span className="brand-mark"><Activity size={19}/></span><h1>InsightForge</h1><p>Checking your private workspace…</p></div></div>;
  }
  if (!auth.isAuthenticated) {
    return <div className="auth-screen"><div className="auth-card"><span className="brand-mark"><Activity size={19}/></span><div className="eyebrow">PRIVATE DATA WORKSPACE</div><h1>InsightForge</h1><p>Sign in to upload private datasets, run analyses, and save experiments and reports to your account.</p><button className="btn primary auth-login" onClick={auth.login}><ShieldCheck size={16}/> Continue with Replit</button><small>Your files are only available to your signed-in account.</small></div></div>;
  }
  return <WorkspaceProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
    <Switch>
      <Route path="/"><Shell title="Overview"><Overview/></Shell></Route>
      <Route path="/datasets"><Shell title="Datasets"><Datasets/></Shell></Route>
      <Route path="/profiling"><Shell title="Data Profiling"><Profiling/></Shell></Route>
      <Route path="/exploratory-analysis"><Shell title="Exploratory Analysis"><EDA/></Shell></Route>
      <Route path="/statistics"><Shell title="Statistics"><Statistics/></Shell></Route>
      <Route path="/ml-lab"><Shell title="ML Lab"><MLLab/></Shell></Route>
      <Route path="/explainability"><Shell title="Model Explainability"><Explainability/></Shell></Route>
      <Route path="/experiments"><Shell title="Experiments"><Experiments/></Shell></Route>
      <Route path="/ai-analyst"><Shell title="AI Data Analyst"><Analyst/></Shell></Route>
      <Route path="/reports"><Shell title="Reports"><Reports/></Shell></Route>
      <Route path="/settings"><Shell title="Settings"><SettingsPage/></Shell></Route>
      <Route path="/help"><Shell title="Help & support"><HelpPage/></Shell></Route>
      <Route><Shell title="Not found"><div className="empty-state"><h1>Page not found</h1><p>The page you’re looking for isn’t in this workspace.</p></div></Shell></Route>
    </Switch>
  </WouterRouter></WorkspaceProvider>;
}

export default App;