import React, { useEffect, useRef } from 'react';


const LiveStream = ({ socket }) => {
  const videoRef = useRef();

  useEffect(() => {
      // USE the prop socket, DO NOT create a new connection
      if (socket) {
        socket.on('frame', (imageData) => {
          if (videoRef.current) {
            // Prepend header to inform browser it's a JPEG[cite: 1]
            videoRef.current.src = `data:image/jpeg;base64,${imageData}`;
          }
        });
      }

      return () => {
        if (socket) socket.off('frame');
      };
    }, [socket]); // Only re-run if the socket prop changes

    return (
      <div className="items-center mt-5 backdrop-blur-sm justify-center rounded-2xl">
        <img ref={videoRef} style={{ borderRadius: '15px' }} height={500} width={1200} alt='Live Stream' />
      </div>
    );
  };

  export default LiveStream;
