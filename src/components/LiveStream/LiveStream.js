import React, { useEffect, useRef } from 'react';
import socketIOClient from 'socket.io-client';

const LiveStream = () => {
  const videoRef = useRef();

  useEffect(() => {
    //connected to backend
    const socket = socketIOClient('http://localhost:5000');
    console.log(socket);
    socket.on('frame', (imageData) => {
      // console.log(imageData);
      // Update the video element with the received frame
      videoRef.current.src = `data:image/jpeg;base64,${imageData}`;
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="items-center mt-5 backdrop-blur-sm justify-center rounded-2xl">
      {/* <div className='absolute mt-2 ml-4'>
        <div className='font-bold  text-red-600'>
          Temperature : ---
        </div>
        <div className='font-bold  text-red-600'>
          Humidity : ---
        </div>
      </div> */}
      <img ref={videoRef} style={{ borderRadius: '15px' }} height={500} width={1200} alt='.' className='' />
    </div>
  );
};

export default LiveStream;
