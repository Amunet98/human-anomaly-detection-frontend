import LiveStream from '../LiveStream/LiveStream';
import { CheckWithUploadOrDrag } from "../CheckWithUploadOrDrag/CheckWithUploadorDrag"
import { CheckWithUrl } from "../CheckWithUrl/CheckWithUrl"
import { Divider, useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { FooterLinks } from '../Footer/Footer';
import socketIOClient from 'socket.io-client';
import React, { useEffect, useRef } from 'react';

export const Home = ({ socket }) => {
    const [details, setDetails] = React.useState("Not Detected");
    const theme = useMantineTheme();
    const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

    useEffect(() => {
      // Use the unified socket passed as a prop
      if (socket) {
        socket.on('detected', (data) => {
          setDetails(data);
        });
      }

      // Clean up the listener when the component unmounts
      return () => {
        if (socket) socket.off('detected');
      };
    }, [socket]);

    // Shared by the upload/URL check panels so a manual check also updates
    // this badge, not just live-feed detections.
    const handleAnalysisResult = (data) => {
        setDetails(data?.top?.className || 'Not Detected');
    };

    return (
        <div className='flex flex-col mt-20 justify-center'>
            <div className='mb-5 font-mono ml-2 text-xl font-medium text-center'>
                Live Feed
            </div>
            <div className='live mt-2 mb-20 flex justify-center bg-slate-700'>
                {/* Pass the socket prop to LiveStream */}
                <LiveStream socket={socket} />
            </div>
            <div className='text-center px-4'>
                <span className='inline-block p-3 rounded-xl font-mono font-bold text-lg text-black bg-yellow-400'>
                    {details}
                </span>
            </div>

            <hr className='m-10' />
            <div className='mb-5 font-mono ml-2 text-xl font-medium text-center'>Check with url and Image Upload</div>
            <div className='mb-20 mt-14 flex self-center flex-col sm:flex-row justify-center items-center gap-8 sm:gap-4 px-4'>
                <div className='flex w-full sm:w-auto justify-center'>
                    < CheckWithUploadOrDrag onResult={handleAnalysisResult} />
                </div>
                <Divider my="sm" orientation={isMobile ? 'horizontal' : 'vertical'} className={isMobile ? 'w-full' : ''} />
                <div className='flex w-full sm:w-auto justify-center'>
                    <CheckWithUrl onResult={handleAnalysisResult} />
                </div>
            </div>
            <hr />
        </div>
    )
}
