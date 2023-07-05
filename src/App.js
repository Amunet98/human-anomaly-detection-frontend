import './App.css';
import { FooterLinks } from './components/Footer/Footer';
import { HeaderResponsive } from './components/Header/Header';
import { Home } from "./components/Home/Home"
import { BrowserRouter as Router, Switch, Routes, Route, Link } from 'react-router-dom';
import { About } from './components/AboutProject/AboutProject';
import { ReferencePapers } from './components/ReferencePapers/ReferencePapers';
import { io } from "socket.io-client";

const socket = io("ws://192.168.137.209:81/", {
  // withCredentials: true,
  origin: '*', 
  transports: ["websocket"]
});




const headerLinks = [{ link: '/', label: 'Home' }, { link: '/about', label: 'About US' }];
function App() {
  // socket.on('connect', () => {
  //   console.log(`I'm connected with the back-end`);
  //   socket.emit('baby', 'what is going on');
  //   socket.on('disconnect', () => {
  //     console.log('user disconnected');
  //   });
  // });
  // socket.on('message', (msg) => {
  //   console.log(msg);
  // });
  // socket.on('baby', (msg) => {
  //   console.log(msg);
  // });
  // socket.emit('baby', 'what is going on');

  return (
    <>
      <div className='head flex justify-center flex-col items-center'>
        <div className='mb-12'>
          <HeaderResponsive links={headerLinks} />
        </div>
        <hr className='mt-4' />
      </div>
      <Routes>
        <Route path='/' element={<Home socket={socket} />} />
        <Route exact path='/about' element={<About />} />
        <Route path='/refrence_papers' element={<ReferencePapers />} />
      </Routes>
      <div className='flex justify-center text-cyan-50' >
        <FooterLinks />
      </div>

    </>
  );
}

export default App;
