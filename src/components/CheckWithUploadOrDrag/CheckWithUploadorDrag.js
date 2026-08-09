import { useRef, useState } from "react";
import { IconUpload, IconPhoto, IconX } from "@tabler/icons-react";
import axios from "axios";
import { API_URL } from "../../lib/api";
import { StillResult } from "../StillResult/StillResult";

const MAX_BYTES = 3 * 1024 ** 2;

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });

// A native <input type="file"> in a label, plus drag handlers - which is all
// @mantine/dropzone was doing here, minus the emotion runtime and the three
// Mantine packages it dragged in. The label makes the whole panel a click
// target and keeps the input keyboard-reachable for free.
export function CheckWithUploadOrDrag({ onResult }) {
  const inputRef = useRef(null);
  const [dragState, setDragState] = useState('idle'); // idle | accept | reject
  const [preview, setPreview] = useState(null);
  const [detections, setDetections] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const analyse = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That image is over the 3 MB limit.');
      return;
    }

    const dataUrl = await toBase64(file);
    // Shown immediately, before the request resolves - the round trip to a
    // free-tier host that may be cold-starting is long enough that showing
    // nothing reads as broken.
    setPreview(dataUrl);
    setDetections(null);
    setError(null);
    setLoading(true);
    try {
      const response = await axios.post(`${API_URL}/analyze`, { image: dataUrl });
      setDetections(response.data.detections || []);
      onResult?.(response.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      onResult?.(null);
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragState('idle');
    analyse(event.dataTransfer.files?.[0]);
  };

  const onDragOver = (event) => {
    // Without preventDefault the browser navigates to the dropped file.
    event.preventDefault();
    const item = event.dataTransfer.items?.[0];
    setDragState(item && item.kind === 'file' && !item.type.startsWith('image/')
      ? 'reject'
      : 'accept');
  };

  const Icon = dragState === 'reject' ? IconX : dragState === 'accept' ? IconUpload : IconPhoto;

  return (
    <div className="w-full max-w-md">
      <h3 className="font-mono text-sm font-medium text-head mb-3">Upload an image</h3>

      <label
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragState('idle')}
        className={`flex flex-col items-center justify-center gap-3 min-h-55 px-6 py-8 text-center rounded-2xl border border-dashed cursor-pointer transition-colors duration-200 bg-raise ${
          dragState === 'reject'
            ? 'border-accent text-accent'
            : dragState === 'accept'
              ? 'border-accent bg-accent-dim text-head'
              : 'border-line hover:border-line-bright text-dim'
        } ${loading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={loading}
          onChange={(event) => {
            analyse(event.target.files?.[0]);
            // Reset so re-selecting the same file fires change again.
            event.target.value = '';
          }}
        />
        <Icon size={44} stroke={1.5} aria-hidden="true" />
        <span className="text-head">
          {loading ? 'Analysing…' : 'Drop an image here, or tap to choose one'}
        </span>
        <span className="text-xs text-dim">PNG or JPEG, up to 3 MB</span>
      </label>

      <StillResult src={preview} detections={detections} loading={loading} error={error} />
    </div>
  );
}
