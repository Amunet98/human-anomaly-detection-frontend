import LiveStream from '../LiveStream/LiveStream';
import { CheckWithUploadOrDrag } from "../CheckWithUploadOrDrag/CheckWithUploadorDrag"
import { CheckWithUrl } from "../CheckWithUrl/CheckWithUrl"
import { Divider } from '@mantine/core';
import { FooterLinks } from '../Footer/Footer';
import socketIOClient from 'socket.io-client';
import React, { useEffect, useRef } from 'react';

export const Home = ({ socket }) => {
    const [details, setDetails] = React.useState("Not Detected");

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

    return (
        <div className='flexs flex-col mt-20 justify-center'>
            <div className='mb-5 font-mono ml-2 text-xl font-medium text-center'>
                Live Feed
            </div>
            <div className='live mt-2 mb-20 flex justify-center bg-slate-700'>
                {/* Pass the socket prop to LiveStream */}
                <LiveStream socket={socket} />
            </div>
            <div className='text-center'>
                <span className='p-3 rounded-xl font-mono font-bold text-lg text-black w-48 bg-yellow-400'>
                    {details}
                </span>
            </div>

            <hr className='m-10' />
            <div className='mb-5 font-mono ml-2 text-xl font-medium text-center'>Check with url and Image Upload</div>
            <div className='mb-20 mt-14 flex self-center flex-row justify-center'>
                <div className='flex'>
                    < CheckWithUploadOrDrag />
                </div>
                <Divider my="sm" className='mr-16 ml-16' orientation='vertical' />
                <div className='flex'>
                    <CheckWithUrl />
                </div>
            </div>
            <hr />
        </div>
    )
}
