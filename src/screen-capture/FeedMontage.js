'use strict';

// 连抓 N 帧并拼成一张网格图，让 agent 一次看全一条视频的进程，而不是靠单帧猜。
// 拼图用 Pillow（DSH 自带 Python runtime），纯本地、无网络。

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PYTHON = process.env.DSH_PYTHON ||
  path.join(os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe');

const MONTAGE_PY = `import sys, json
from PIL import Image, ImageDraw
paths = json.loads(sys.argv[1])
out_path = sys.argv[2]
cols = int(sys.argv[3])
cell_w, cell_h = 420, 250
thumbs = []
for i, f in enumerate(paths):
    im = Image.open(f).convert("RGB")
    im.thumbnail((cell_w - 8, cell_h - 30))
    canvas = Image.new("RGB", (cell_w, cell_h), (18, 18, 18))
    canvas.paste(im, (4, 26))
    ImageDraw.Draw(canvas).text((6, 6), "#%d" % (i + 1), fill=(255, 224, 64))
    thumbs.append(canvas)
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (0, 0, 0))
for i, t in enumerate(thumbs):
    sheet.paste(t, ((i % cols) * cell_w, (i // cols) * cell_h))
sheet.save(out_path)
print(out_path)
`;

/**
 * 连抓 frames 帧（不滚动），拼成网格图。
 * @param {object} capture - ScreenCapture 实例（有 captureOnce）
 * @param {object} opts - { frames, intervalMs, cols, outputDir, prefix }
 * @returns {Promise<{frames:string[], montage:string, width:number, height:number}>}
 */
async function captureMontage(capture, opts = {}) {
  const frames = Math.max(1, Math.min(60, Math.trunc(opts.frames || 12)));
  const intervalMs = Math.max(50, Math.trunc(opts.intervalMs || 400));
  const cols = Math.max(1, Math.min(12, Math.trunc(opts.cols || 4)));
  const outputDir = opts.outputDir || capture.config.outputDir;
  const prefix = opts.prefix || `montage-${Date.now()}-${process.pid}`;
  fs.mkdirSync(outputDir, { recursive: true });

  const framePaths = [];
  for (let i = 0; i < frames; i++) {
    const meta = await capture.captureOnce({ outputDir });
    framePaths.push(meta.path);
    if (i < frames - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }

  const montagePath = path.join(outputDir, `${prefix}.png`);
  let usedPython = false;
  try {
    execFileSync(PYTHON, ['-c', MONTAGE_PY, JSON.stringify(framePaths), montagePath, String(cols)], {
      timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    usedPython = true;
  } catch (e) {
    // Pillow 不可用时回退：把第一帧当拼图返回，至少不中断刷流
    fs.copyFileSync(framePaths[0], montagePath);
  }

  return {
    frames: framePaths,
    montage: montagePath,
    usedPython,
    count: framePaths.length,
    cols
  };
}

module.exports = { captureMontage, PYTHON };
