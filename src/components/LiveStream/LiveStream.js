import React, { useEffect, useRef, useState } from 'react';

// How often a captured camera frame is sent to the backend for detection -
// matches the backend's own INFERENCE_INTERVAL_MS throttle, no point sending
// faster than it will actually sample.
const CAPTURE_INTERVAL_MS = 500;

const LiveStream = ({ socket }) => {
  const videoRef = useRef();
  const imgRef = useRef();
  const canvasRef = useRef();
  const streamRef = useRef();
  const [usingOwnCamera, setUsingOwnCamera] = useState(false);
  const [details, setDetails] = useState('Not Detected');

  // Try the visitor's own camera first; fall back to the shared demo feed
  // (server-opencv's camera/sample video, relayed by the backend) if
  // permission is denied or no camera is available.
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia?.({ video: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setUsingOwnCamera(true);
      })
      .catch(() => {
        // Permission denied, no camera, or unsupported browser - keep
        // showing the shared demo feed instead.
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (usingOwnCamera && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [usingOwnCamera]);

  // Own camera: periodically capture a frame and send it to the backend for
  // detection, scoped to just this connection (see 'own-detected' below) -
  // it is never rebroadcast to other visitors.
  useEffect(() => {
    if (!usingOwnCamera || !socket) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
      socket.emit('camera-frame', base64);
    }, CAPTURE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [usingOwnCamera, socket]);

  // Badge: 'own-detected' is targeted just at this connection (own camera),
  // 'detected' is the shared demo feed's global broadcast - never both at
  // once, so switch which one is trusted based on the current mode.
  useEffect(() => {
    if (!socket) return;
    const event = usingOwnCamera ? 'own-detected' : 'detected';
    socket.on(event, setDetails);
    return () => socket.off(event, setDetails);
  }, [usingOwnCamera, socket]);

  useEffect(() => {
    if (usingOwnCamera || !socket) return;
    const handleFrame = (imageData) => {
      if (imgRef.current) {
        imgRef.current.src = `data:image/jpeg;base64,${imageData}`;
      }
    };
    socket.on('frame', handleFrame);
    return () => socket.off('frame', handleFrame);
  }, [usingOwnCamera, socket]);

  return (
    <div className="items-center mt-5 backdrop-blur-sm justify-center rounded-2xl w-full px-4">
      {/* Fixed 1200x500 attributes used to force a 1200px-wide page on
          phones (~375-430px viewports) - scale to the container instead,
          capped at a sane desktop size, matching the camera's 4:3 capture. */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {usingOwnCamera ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="rounded-2xl w-full max-w-3xl mx-auto block aspect-[4/3] object-cover bg-black/20"
        />
      ) : (
        <img
          ref={imgRef}
          className="rounded-2xl w-full max-w-3xl mx-auto block aspect-[4/3] object-cover bg-black/20"
          alt='Live Stream'
        />
      )}
      <div className='text-center px-4 mt-5'>
        <span className='inline-block p-3 rounded-xl font-mono font-bold text-lg text-black bg-yellow-400'>
          {details}
        </span>
      </div>
      <div className='text-center text-xs font-mono opacity-60 mt-2'>
        {usingOwnCamera ? 'Using your camera' : 'Camera unavailable - showing demo feed'}
      </div>
    </div>
  );
};

export default LiveStream;
