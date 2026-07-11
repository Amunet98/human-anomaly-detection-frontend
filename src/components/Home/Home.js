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
            <div className='mb-2 text-center'>
                <span className='section-tag'>Live Feed</span>
            </div>
            <div className='mb-1 text-center text-2xl font-bold'>Watching for falls, live</div>
            <div className='mb-5 text-center text-sm opacity-60 px-4'>
                YOLOv8 running server-side against the stream below — your camera if you allow it, the shared demo feed if not.
            </div>
            <div className='live mt-2 mb-20 flex justify-center'>
                {/* Pass the socket prop to LiveStream */}
                <LiveStream socket={socket} />
            </div>

            <hr className='mx-10 my-6 border-gray-500/30' />
            <div className='mb-2 text-center'>
                <span className='section-tag'>Image Check</span>
            </div>
            <div className='mb-1 text-center text-2xl font-bold'>Try the model on a single image</div>
            <div className='mb-5 text-center text-sm opacity-60 px-4'>
                Upload a photo or paste an image URL — same self-hosted model, one-off inference.
            </div>
            <div className='mb-20 mt-14 flex self-center flex-col sm:flex-row justify-center items-center gap-8 sm:gap-4 px-4'>
                <div className='flex w-full sm:w-auto justify-center'>
                    < CheckWithUploadOrDrag />
                </div>
                <Divider my="sm" orientation={isMobile ? 'horizontal' : 'vertical'} className={isMobile ? 'w-full' : ''} />
                <div className='flex w-full sm:w-auto justify-center'>
                    <CheckWithUrl />
                </div>
            </div>
            <hr className='border-gray-500/30' />
        </div>
    )
}
