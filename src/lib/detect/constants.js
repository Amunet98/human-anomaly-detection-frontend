// Shared constants for the in-browser detection pipeline.
//
// These mirror the server's inference.js so that a frame analysed in the browser
// and the same frame POSTed to /analyze produce the same detections. If you
// retrain the model, both sides have to move together - see MODEL_CARD.md.

export const INPUT_SIZE = 640;

// Class order is the model's, not a preference: best.onnx carries
// names = {0: 'fall', 1: 'sit', 2: 'stand'} in its ultralytics metadata.
// Matches CLASS_NAMES in the backend's render.yaml / .env.
export const CLASS_NAMES = ['fall', 'sit', 'stand'];

// Ultralytics letterbox padding.
export const PAD_RGB = [114, 114, 114];

// Same defaults as the server (DETECTION_CONFIDENCE=0.4, IOU 0.45). The
// confidence floor is adjustable at runtime from the UI; this is the starting
// point and the value the parity test compares against.
export const DEFAULT_CONF_THRESHOLD = 0.4;
export const IOU_THRESHOLD = 0.45;

// Byte length of src/model/best.onnx. Needed because Vercel serves the model
// brotli-compressed and therefore *without* a Content-Length, so a download
// progress bar has nothing else to divide by. Update on retrain.
export const MODEL_BYTES = 12266856;
