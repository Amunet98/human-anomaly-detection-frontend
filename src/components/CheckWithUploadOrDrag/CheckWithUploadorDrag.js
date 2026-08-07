import { Group, Text, useMantineTheme, rem } from "@mantine/core";
import { IconUpload, IconPhoto, IconX } from "@tabler/icons-react";
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import { useState } from "react";
import axios from "axios";
import { API_URL } from "../../lib/api";
import { StillResult } from "../StillResult/StillResult";

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });

export function CheckWithUploadOrDrag({ onResult }) {
  const theme = useMantineTheme();
  const [preview, setPreview] = useState(null);
  const [detections, setDetections] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const analyse = async (files) => {
    const dataUrl = await toBase64(files[0]);
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

  return (
    <div className="w-full max-w-md">
      <span className="text-center text-lg font-mono font-medium self-center">
        Test using PC Image.
      </span>
      <Dropzone onDrop={analyse} maxSize={3 * 1024 ** 2} accept={IMAGE_MIME_TYPE} loading={loading}>
        <Group
          position="center"
          spacing="xl"
          style={{ minHeight: rem(220), pointerEvents: "none" }}
        >
          <Dropzone.Accept>
            <IconUpload
              size="3.2rem"
              stroke={1.5}
              color={theme.colors[theme.primaryColor][theme.colorScheme === "dark" ? 4 : 6]}
            />
          </Dropzone.Accept>
          <Dropzone.Reject>
            <IconX
              size="3.2rem"
              stroke={1.5}
              color={theme.colors.red[theme.colorScheme === "dark" ? 4 : 6]}
            />
          </Dropzone.Reject>
          <Dropzone.Idle>
            <IconPhoto size="3.2rem" stroke={1.5} />
          </Dropzone.Idle>

          <div>
            <Text size="xl" inline>
              Drag images here or click to select files
            </Text>
            <Text size="sm" color="dimmed" inline mt={7}>
              Attach files
            </Text>
          </div>
        </Group>
      </Dropzone>

      <StillResult src={preview} detections={detections} loading={loading} error={error} />
    </div>
  );
}
