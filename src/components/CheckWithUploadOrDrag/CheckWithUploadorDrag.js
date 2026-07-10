import { Group, Text, useMantineTheme, rem } from "@mantine/core";
import { IconUpload, IconPhoto, IconX } from "@tabler/icons-react";
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import { useState } from "react";
import axios from "axios";
import { JSONTree } from "react-json-tree";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8081";

export function CheckWithUploadOrDrag() {
  const toBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
    });
  const theme = useMantineTheme();
  const [results, setResult] = useState();

  return (
    <div className="">
      <div className="">
        <span>
          <span className="text-center text-lg font-mono font-medium self-center">
            Test using PC Image.
          </span>
          <div>
            <Dropzone
              onDrop={async (files) => {
                const base64StringImage = await toBase64(files[0]);
                axios
                  .post(`${API_URL}/analyze`, { image: base64StringImage })
                  .then((response) => setResult(response.data))
                  .catch((error) => setResult(error.message));
              }}
              onReject={(files) => console.log("rejected files", files)}
              maxSize={3 * 1024 ** 2}
              accept={IMAGE_MIME_TYPE}
            >
              <Group
                position="center"
                spacing="xl"
                style={{ minHeight: rem(220), pointerEvents: "none" }}
              >
                <Dropzone.Accept>
                  <IconUpload
                    size="3.2rem"
                    stroke={1.5}
                    color={
                      theme.colors[theme.primaryColor][
                        theme.colorScheme === "dark" ? 4 : 6
                      ]
                    }
                  />
                </Dropzone.Accept>
                <Dropzone.Reject>
                  <IconX
                    size="3.2rem"
                    stroke={1.5}
                    color={
                      theme.colors.red[theme.colorScheme === "dark" ? 4 : 6]
                    }
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
          </div>
        </span>
      </div>
      <div className="mt-10 flex-wrap">
        {results ? (
          <div>
            <div className=" text-xl font-bold font-mono">Result for Scan</div>
            {/* <ReactJson className='flex' src={results} theme="brewer" /> */}
            <div className="m-5">
              <JSONTree data={results} theme={theme} invertTheme={false} />
            </div>
            {/* <pre className=' flex mt-4 w-96 h-52' title='Results'>{results}</pre> */}
          </div>
        ) : null}
      </div>
    </div>
  );
}
