// Paints magic circle layers off the main thread (see magicCircle.js).
import { paintLayer, CIRCLE_SIZE } from './circlePaint.js';

self.onmessage = async ({ data: { key, seed, tier, layer } }) => {
  const cv = new OffscreenCanvas(CIRCLE_SIZE, CIRCLE_SIZE);
  paintLayer(cv, seed, tier, layer);
  // the texels WebGL would upload from a canvas: flipped (UNPACK_FLIP_Y) and not premultiplied
  const bitmap = await createImageBitmap(cv, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  self.postMessage({ key, bitmap }, [bitmap]);
};
