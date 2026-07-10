import './App.css';
import { FooterLinks } from './components/Footer/Footer';
import { HeaderResponsive } from './components/Header/Header';
import { Home } from "./components/Home/Home";
import { About } from './components/AboutProject/AboutProject';
import { ReferencePapers } from './components/ReferencePapers/ReferencePapers';
import { io } from "socket.io-client";
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { MantineProvider, ColorSchemeProvider } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8081";

const socket = io(API_URL, {
  transports: ["websocket"]
});

const headerLinks = [{ link: '/', label: 'Home' }, { link: '/about', label: 'About US' }];

function App() {
  const [colorScheme, setColorScheme] = useLocalStorage({
    key: 'color-scheme',
    defaultValue: 'dark',
  });
  const toggleColorScheme = (value) =>
    setColorScheme(value || (colorScheme === 'dark' ? 'light' : 'dark'));

  return (
    <ColorSchemeProvider colorScheme={colorScheme} toggleColorScheme={toggleColorScheme}>
      <MantineProvider theme={{ colorScheme }} withGlobalStyles withNormalizeCSS>
        <Router>
          <div
            className={
              colorScheme === 'dark'
                ? 'min-h-screen bg-gray-900 text-gray-50'
                : 'min-h-screen bg-white text-gray-900'
            }
          >
            <div className='head flex justify-center flex-col items-center'>
              <div className='mb-12'>
                <HeaderResponsive links={headerLinks} />
              </div>
              <hr className='mt-4' />
            </div>

            <Routes>
              <Route path='/' element={<Home socket={socket} />} />
              <Route path='/about' element={<About />} />
              <Route path='/refrence_papers' element={<ReferencePapers />} />
            </Routes>

            <div className='flex justify-center text-cyan-50'>
              <FooterLinks />
            </div>
          </div>
        </Router>
      </MantineProvider>
    </ColorSchemeProvider>
  );
}

export default App;
