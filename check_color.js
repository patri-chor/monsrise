import fs from 'fs';
import { PNG } from 'pngjs';

const data = fs.readFileSync('public/frames/101.png');
const png = PNG.sync.read(data);

const sy = 80;
const sx = 0;
const size = 40;

let rSum = 0, gSum = 0, bSum = 0, count = 0;
for (let y = sy; y < sy + size; y++) {
  for (let x = sx; x < sx + size; x++) {
    const idx = (png.width * y + x) << 2;
    const r = png.data[idx];
    const g = png.data[idx + 1];
    const b = png.data[idx + 2];
    const a = png.data[idx + 3];
    if (a > 10) {
      rSum += r;
      gSum += g;
      bSum += b;
      count++;
    }
  }
}

if (count > 0) {
  console.log(`Frame 3rd row average color: R=${rSum/count}, G=${gSum/count}, B=${bSum/count} (opaque pixels: ${count})`);
} else {
  console.log(`No opaque pixels found`);
}
