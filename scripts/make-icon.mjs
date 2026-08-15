// 把 assets/icon.svg(黑色鲸鱼)转成多个尺寸的 PNG,供窗口/托盘/打包使用。
// electron-builder 会用 512 的 PNG 自动生成 .ico(安装包 + 快捷方式)。
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'assets', 'icon.svg');
const sizes = [
  { name: 'icon.png', size: 512 },
  { name: 'icon-256.png', size: 256 },
  { name: 'icon-32.png', size: 32 },
  { name: 'icon-16.png', size: 16 },
];

for (const { name, size } of sizes) {
  const out = path.join(root, 'build', name);
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(out);
  console.log(`生成 ${name} (${size}x${size})`);
}
console.log('图标生成完成');
