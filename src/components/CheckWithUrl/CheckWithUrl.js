import { useState } from 'react';
import { TextInput, createStyles, Button, rem } from '@mantine/core';
import axios from 'axios';
import { API_URL } from '../../lib/api';
import { StillResult } from '../StillResult/StillResult';

const useStyles = createStyles((theme, { floating }) => ({
    root: {
        position: 'relative',
    },

    label: {
        position: 'absolute',
        zIndex: 2,
        top: rem(7),
        left: theme.spacing.sm,
        pointerEvents: 'none',
        color: floating
            ? theme.colorScheme === 'dark'
                ? theme.white
                : theme.black
            : theme.colorScheme === 'dark'
                ? theme.colors.dark[3]
                : theme.colors.gray[5],
        transition: 'transform 150ms ease, color 150ms ease, font-size 150ms ease',
        transform: floating ? `translate(-${theme.spacing.sm}, ${rem(-28)})` : 'none',
        fontSize: floating ? theme.fontSizes.xs : theme.fontSizes.sm,
        fontWeight: floating ? 500 : 400,
    },

    required: {
        transition: 'opacity 150ms ease',
        opacity: floating ? 1 : 0,
    },

    input: {
        '&::placeholder': {
            transition: 'color 150ms ease',
            color: !floating ? 'transparent' : undefined,
        },
    },

    button: {
        position: 'relative',
        transition: 'background-color 150ms ease',
    },

    labelButton: {
        position: 'relative',
        zIndex: 1,
    },
}));

export function CheckWithUrl({ onResult }) {
    const [focused, setFocused] = useState(false);
    const [value, setValue] = useState('');
    const { classes } = useStyles({ floating: value.trim().length !== 0 || focused });

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
            <span className='text-center text-lg font-mono font-medium'>
                Test using Url
            </span>
            <TextInput
                label="URL"
                placeholder="Put url of Photo to test"
                required
                classNames={classes}
                value={value}
                onChange={(event) => setValue(event.currentTarget.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(event) => event.key === 'Enter' && analyse()}
                mt="md"
                autoComplete="nope"
            />
            <Button
                fullWidth
                className="bg-green-500 hover:bg-green-500 text-gray-50 mt-2"
                onClick={analyse}
                loading={loading}
                disabled={!value.trim()}
            >
                Check
            </Button>

            <StillResult src={preview} detections={detections} loading={loading} error={error} />
        </div>
    );
}
