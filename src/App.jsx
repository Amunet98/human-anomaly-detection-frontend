import './App.css';
import { FooterLinks } from './components/Footer/Footer';
import { SiteHeader } from './components/Header/Header';
import { Home } from './components/Home/Home';
import { About } from './components/AboutProject/AboutProject';
import { ReferencePapers } from './components/ReferencePapers/ReferencePapers';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useTheme } from './hooks/useTheme';

const headerLinks = [
  { link: '/', label: 'home' },
  { link: '/about', label: 'about' },
  { link: '/refrence_papers', label: 'papers' },
];

// When served through the portfolio's microfrontends proxy at
// bimeshpoudel.com.np/human-anomaly-live-demo, the URL keeps that prefix
// (it's a rewrite, not a redirect) - react-router needs to know about it or
// in-app links resolve relative to "/" and land outside the proxied path.
// Direct access via the standalone frontend-new-inky-zeta.vercel.app URL
// has no such prefix, so this only applies when it's actually present.
const MICROFRONTENDS_BASE = '/human-anomaly-live-demo';
const basename = window.location.pathname.startsWith(MICROFRONTENDS_BASE)
  ? MICROFRONTENDS_BASE
  : undefined;

function App() {
  const { theme, toggleTheme } = useTheme();

  return (
    <Router basename={basename}>
      <div className="min-h-dvh bg-canvas text-body flex flex-col">
        <SiteHeader links={headerLinks} theme={theme} onToggleTheme={toggleTheme} />

        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/refrence_papers" element={<ReferencePapers />} />
          </Routes>
        </main>

        <FooterLinks />
      </div>
    </Router>
  );
}

export default App;
