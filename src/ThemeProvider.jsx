import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { ThemeContext } from './theme-context';

const THEME_KEY = 'sentinel_theme';

const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'system');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

ThemeProvider.propTypes = { children: PropTypes.node.isRequired };

export default ThemeProvider;
