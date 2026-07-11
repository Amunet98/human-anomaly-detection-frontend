import LiveStream from '../LiveStream/LiveStream';
import { CheckWithUploadOrDrag } from "../CheckWithUploadOrDrag/CheckWithUploadorDrag"
import { CheckWithUrl } from "../CheckWithUrl/CheckWithUrl"
import { Divider, useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { FooterLinks } from '../Footer/Footer';
import React from 'react';

export const Home = ({ socket }) => {
    const theme = useMantineTheme();
    const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

    return (
        <div className='flex flex-col mt-20 justify-center'>
            <div className='mb-5 font-mono ml-2 text-xl font-medium text-center'>
                Live Feed
            </div>
            <div className='live mt-2 mb-20 flex justify-center bg-slate-700'>
                {/* Pass the socket prop to LiveStream */}
                <LiveStream socket={socket} />
            </div>

            <hr className='m-10' />
            <div className='mb-5 font-mono ml-2 text-xl font-medium text-center'>Check with url and Image Upload</div>
            <div className='mb-20 mt-14 flex self-center flex-col sm:flex-row justify-center items-center gap-8 sm:gap-4 px-4'>
                <div className='flex w-full sm:w-auto justify-center'>
                    < CheckWithUploadOrDrag />
                </div>
                <Divider my="sm" orientation={isMobile ? 'horizontal' : 'vertical'} className={isMobile ? 'w-full' : ''} />
                <div className='flex w-full sm:w-auto justify-center'>
                    <CheckWithUrl />
                </div>
            </div>
            <hr />
        </div>
    )
}
