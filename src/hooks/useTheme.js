import { useCallback, useEffect, useState } from 'react';

// Deliberately the same contract as the portfolio's ThemeToggle: the
// `data-theme` attribute on <html> and the localStorage key "theme".
//
// This demo is served from the portfolio's own origin (bimeshpoudel.com.np
// /human-anomaly-live-demo, a microfrontends rewrite rather than a redirect),
// so localStorage is shared between the two apps - matching the key means a
// visitor who picked the light theme on the portfolio arrives here already in
// it, instead of the demo starting dark and flipping under them.
function getInitialTheme() {
  const stored = window.localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  // The terminal look is dark by default whatever the OS says; light is an
  // explicit opt-in.
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
    [],
  );

  return { theme, toggleTheme };
}
