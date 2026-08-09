import LiveStream from '../LiveStream/LiveStream';
import { CheckWithUploadOrDrag } from '../CheckWithUploadOrDrag/CheckWithUploadorDrag';
import { CheckWithUrl } from '../CheckWithUrl/CheckWithUrl';
import { useEffect, useMemo } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../../lib/api';

export const Home = () => {
    // Only connect while someone is actually on this page - the backend
    // counts every open connection as a viewer and (once the shared demo
    // feed is running) wakes the camera capture service for it, so opening
    // a socket on /about or /refrence_papers as well would waste that for
    // no visible feed.
    const socket = useMemo(() => io(API_URL, { transports: ['websocket'] }), []);
    useEffect(() => () => socket.disconnect(), [socket]);

    return (
        <div className='pb-16'>
            {/* The live console is the product; it leads, and everything else
                is secondary to it. Tight top spacing on mobile so the feed
                itself is what you land on. */}
            <section className='pt-6 sm:pt-10'>
                <SectionHeading
                    tag='Live feed'
                    title='Watching for falls, live'
                    lede='YOLOv8 with IoU tracking and temporal voting. Run it server-side, or load the model into this tab and run it in real time.'
                />
                <LiveStream socket={socket} />
            </section>

            <hr className='my-14 sm:my-20 border-line' />

            <section className='page-gutter'>
                <SectionHeading
                    tag='Image check'
                    title='Try the model on a single image'
                    lede='Upload a photo or paste an image URL — same self-hosted model, one-off inference.'
                    gutter={false}
                />
                <div className='mx-auto max-w-4xl flex flex-col sm:flex-row justify-center items-start gap-10 sm:gap-8'>
                    <CheckWithUploadOrDrag />
                    {/* Divider: a horizontal rule between stacked cards on
                        mobile, a vertical one between side-by-side cards from
                        sm up. CSS-only, replacing Mantine's Divider plus the
                        useMediaQuery that used to drive its orientation. */}
                    <div
                        className='w-full h-px sm:w-px sm:h-auto sm:self-stretch bg-line flex-shrink-0'
                        aria-hidden='true'
                    />
                    <CheckWithUrl />
                </div>
            </section>
        </div>
    );
};

function SectionHeading({ tag, title, lede, gutter = true }) {
    return (
        <div className={`text-center mb-8 ${gutter ? 'page-gutter' : ''}`}>
            <span className='section-tag'>{tag}</span>
            <h2 className='mt-4 text-2xl sm:text-3xl font-bold text-head'>{title}</h2>
            <p className='mt-3 mx-auto max-w-prose text-sm text-dim'>{lede}</p>
        </div>
    );
}
