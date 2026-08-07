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

// Minimum box area as a fraction of the *largest* surviving box, applied after
// NMS. Kills the sub-limb false positives the model emits on a hand or a shoe -
// measured case: a 130x96 box on a subject's boot scoring `stand 0.43`, sitting
// at 3.1% of the true person box's area while the three real subjects all sit at
// 100% (they are the largest box in their frame).
//
// Relative rather than an absolute fraction of frame area, because absolute is
// not scale-invariant: a floor tight enough to catch that boot (it is 1.15% of
// the frame) would also delete genuinely distant people in far-field CCTV,
// whereas a relative floor leaves an all-distant scene untouched. 0.15 sits with
// wide margin on both sides of the measured 3.1% / 100% split.
//
// Tradeoff: this does suppress a real second subject standing far behind a close
// one. Acceptable for a single-subject demo; revisit for crowd scenes.
export const MIN_BOX_AREA_RATIO = 0.15;

// Byte length of src/model/best.onnx. Needed because Vercel serves the model
// brotli-compressed and therefore *without* a Content-Length, so a download
// progress bar has nothing else to divide by. Update on retrain.
export const MODEL_BYTES = 12266856;
