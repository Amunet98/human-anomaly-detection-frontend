// The six perturbations the eval harness replays every fixture through.
//
// Chosen to be things a real deployment hits - a mirrored front camera, a
// night-mode frame, motion blur, a low-bitrate stream, a subject who does not
// fill the frame - not adversarial noise.
//
// Shared between eval-check.mjs, which scores against them, and
// add-fixture.mjs, which previews them for a candidate image before it is
// adopted. One definition, because a fixture that survived a *different* six
// perturbations than the harness applies would be measuring nothing.
//
// Each is a pure function on a sharp instance, so this module needs no imports
// of its own - the caller supplies sharp from wherever it borrowed it.
export const PERTURBATIONS = {
  hflip: (img) => img.flop(),
  grayscale: (img) => img.grayscale(),
  'dark-40%': (img) => img.modulate({ brightness: 0.6 }),
  'blur-3px': (img) => img.blur(3),
  'downscale-320': (img) => img.resize(320),
  'crop-80%': (img, meta) =>
    img.extract({
      left: Math.round(meta.width * 0.1),
      top: Math.round(meta.height * 0.1),
      width: Math.round(meta.width * 0.8),
      height: Math.round(meta.height * 0.8),
    }),
};
