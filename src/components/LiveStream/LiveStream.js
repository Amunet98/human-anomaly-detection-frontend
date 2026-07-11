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
      <div className="items-center mt-5 backdrop-blur-sm justify-center rounded-2xl w-full px-4">
        {/* Fixed 1200x500 attributes used to force a 1200px-wide page on
            phones (~375-430px viewports) - scale to the container instead,
            capped at a sane desktop size, matching the camera's 4:3 capture. */}
        <img
          ref={videoRef}
          className="rounded-2xl w-full max-w-3xl mx-auto block aspect-[4/3] object-cover bg-black/20"
          alt='Live Stream'
        />
      </div>
    );
  };

  export default LiveStream;
