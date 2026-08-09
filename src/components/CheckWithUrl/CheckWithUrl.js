import { useId, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../lib/api';
import { StillResult } from '../StillResult/StillResult';

export function CheckWithUrl({ onResult }) {
    const inputId = useId();
    const [value, setValue] = useState('');

    const [preview, setPreview] = useState(null);
    const [detections, setDetections] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const analyse = async () => {
        const url = value.trim();
        if (!url) return;
        // The backend fetches the URL itself (with SSRF guards); the browser
        // loads it directly for the preview. If the host blocks hotlinking the
        // preview may fail while the analysis still succeeds - the boxes just
        // have nothing to sit on, which is why the chips below list the
        // detections in text too.
        setPreview(url);
        setDetections(null);
        setError(null);
        setLoading(true);
        try {
            const response = await axios.post(`${API_URL}/analyze`, { imageUrl: url });
            setDetections(response.data.detections || []);
            onResult?.(response.data);
        } catch (err) {
            setError(err.response?.data?.error || err.message);
            onResult?.(null);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className='w-full max-w-md'>
            <h3 className='font-mono text-sm font-medium text-head mb-3'>Paste an image URL</h3>

            {/* A permanently visible label rather than the old floating one:
                the placeholder was the only label until you focused the field,
                so the input's purpose disappeared exactly when a screen reader
                or a returning user needed it. */}
            <label htmlFor={inputId} className='block font-mono text-[11px] uppercase tracking-widest text-dim mb-1.5'>
                Image URL
            </label>
            <input
                id={inputId}
                type='url'
                inputMode='url'
                autoComplete='off'
                spellCheck='false'
                placeholder='https://example.com/photo.jpg'
                value={value}
                onChange={(event) => setValue(event.currentTarget.value)}
                onKeyDown={(event) => event.key === 'Enter' && analyse()}
                /* No focus:outline-none here - the global :focus-visible ring in
                   index.css is the keyboard affordance, and the accent border is
                   an addition to it rather than a replacement. */
                className='w-full min-h-11 px-3 rounded-lg bg-raise border border-line text-head placeholder:text-dim transition-colors duration-200 hover:border-line-bright focus:border-accent'
            />

            <button
                type='button'
                onClick={analyse}
                disabled={!value.trim() || loading}
                className='w-full min-h-11 mt-3 rounded-lg bg-accent text-canvas font-mono text-sm font-semibold transition-opacity duration-200 cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed'
            >
                {loading ? 'Checking…' : 'Check'}
            </button>

            <StillResult src={preview} detections={detections} loading={loading} error={error} />
        </div>
    );
}
