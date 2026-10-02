import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from './components';
import { Analyst, Datasets, EDA, Explainability, Experiments, HelpPage, MLLab, Overview, Profiling, Reports, SettingsPage, Statistics } from './pages';

function App() {
  return <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
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
  </WouterRouter>;
}

export default App;