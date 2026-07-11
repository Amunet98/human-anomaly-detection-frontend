import { useState } from 'react';
import { TextInput, createStyles, Button, Progress, rem } from '@mantine/core';
import { useInterval } from '@mantine/hooks';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8081";


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

    progress: {
        ...theme.fn.cover(-1),
        height: 'auto',
        backgroundColor: 'transparent',
        zIndex: 0,
    },

    labelButton: {
        position: 'relative',
        zIndex: 1,
    },
}));



export function CheckWithUrl({ onResult }) {
    const [focused, setFocused] = useState(false);
    const [value, setValue] = useState('');
    const { classes, theme } = useStyles({ floating: value.trim().length !== 0 || focused });

    const [progress, setProgress] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [results, setResult] = useState();


    const interval = useInterval(
        () =>
            setProgress((current) => {
                if (current < 100) {
                    return current + 1;
                }

                interval.stop();
                setLoaded(true);
                return 0;
            }),
        20
    );

    return (
        <div>
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
                mt="md"
                autoComplete="nope"
            />
            <Button
                fullWidth
                className="bg-green-500 hover:bg-green-500 text-gray-50 mt-2"
                onClick={async () => {
                    loaded ? setLoaded(false) : !interval.active && interval.start();
                    axios
                        .post(`${API_URL}/analyze`, { imageUrl: value })
                        .then((response) => {
                            setResult(response.data);
                            onResult?.(response.data);
                        })
                        .catch((error) => {
                            setResult(error.message);
                            onResult?.(null);
                        });
                }}
                color={loaded ? 'teal' : theme.primaryColor}
            >
                {/* <div className={classes.labelButton}>
                    {progress !== 0 ? 'Uploading files' : loaded ? 'Files uploaded' : 'Upload files'}
                </div>
                {progress !== 0 && (
                    <Progress
                        value={progress}
                        className={classes.progress}
                        color={theme.fn.rgba(theme.colors[theme.primaryColor][2], 0.35)}
                        radius="sm"
                    /> */}
                {/* )} */}
                Check
            </Button>

            <div className='mt-10 w-full max-w-96 h-52 overflow-auto flex-wrap'>
                {results ?
                    (<div>
                        <div className=' text-xl font-bold font-mono'>
                            Result for Scan
                        </div>
                        <div className='p-1 text-lg font-mono'>
                            {typeof results === 'string'
                                ? results
                                : results.top?.className || 'Not Detected'}
                        </div>
                    </div>) : null}
            </div>
        </div>
    );
}
