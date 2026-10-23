import { render } from 'preact';
import { Layout } from './components/Layout.tsx';
import { LiveView } from './components/LiveView.tsx';
import { MatchForm } from './components/MatchForm.tsx';
import { MatchList } from './components/MatchList.tsx';
import { Report } from './components/Report.tsx';
import { Scoreboard } from './components/Scoreboard.tsx';
import { Settings } from './components/Settings.tsx';
import { TeamForm, TeamList } from './components/Teams.tsx';
import { parseRoute, useRoute, type Route } from './hooks.ts';
import { getLang, useLang } from './i18n/index.ts';
import { startAutoSync } from './sync.ts';
import './styles.css';

function Page(props: { route: Route }) {
  const route = props.route;
  switch (route.name) {
    case 'matches':
      return <MatchList />;
    case 'newMatch':
      return <MatchForm />;
    case 'editMatch':
      return <MatchForm id={route.id} />;
    case 'match':
      return <Scoreboard id={route.id} />;
    case 'report':
      return <Report id={route.id} />;
    case 'live':
      return <LiveView id={route.id} token={route.token} />;
    case 'teams':
      return <TeamList />;
    case 'newTeam':
      return <TeamForm />;
    case 'team':
      return <TeamForm id={route.id} />;
    case 'settings':
      return <Settings />;
  }
}

function App() {
  const route = useRoute();
  const lang = useLang();
  return (
    <Layout route={route} bare={route.name === 'live'} key={lang}>
      <Page route={route} />
    </Layout>
  );
}

document.documentElement.lang = getLang();
render(<App />, document.getElementById('app')!);

// Spectators opening a live link have no session: do not run the owner's sync for them.
let syncStarted = false;
const startSyncUnlessLive = () => {
  if (syncStarted || parseRoute(location.hash).name === 'live') return;
  syncStarted = true;
  startAutoSync();
};
startSyncUnlessLive();
window.addEventListener('hashchange', startSyncUnlessLive);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Service worker not registered', error));
  });
}
