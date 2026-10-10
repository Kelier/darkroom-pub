# DARKROOM / Feature film

30 秒特色功能介绍 · 1920×1080 · 30 fps · H.264 + AAC。

| 时间 | 特色 | 演示方式 |
| --- | --- | --- |
| 00–02.7 | 一张照片，不止一种可能 | 三种海报开场 |
| 02.7–07 | 主体识别与智能构图 | 实际人物检测框、1:1 与 3:4 智能裁切 |
| 07–12 | 文字与人物的前后关系 | 同图对比遮挡文字、古典明朝环绕 |
| 12–18 | AI 深度与 2.5D 动效 | 深度图与真实 WebGL 视差序列并排 |
| 18–24 | 保留胶片、跨结构版式 | 杂志封面、横向书页、演出海报 |
| 24–27 | 胶卷显影 | 原片与暖负片划擦对比、实体胶卷意象 |
| 27–30 | 本地数字暗房 | 成片集合与品牌落版 |

## 复现

安装 FFmpeg（PATH 可访问）、Python 依赖 `pillow numpy`。

```bash
python3 render.py --stills
python3 render.py
```

输出到上一级 `darkroom-demo.mp4` 与 `demo-cover.jpg`。素材来自应用的真实 `render.js`；深度与分割模型均成功在浏览器执行，证据见 `assets/feature-evidence.json`。72 帧 `motion-*.jpg` 使用真实深度驱动相机参数，视频中插值至 30 fps。深度图做双色可视化；单图深度是 AI 估计，不是真实三维扫描。

`capture-features.mjs` 是素材采集脚本，需要 Puppeteer 与 Chromium，通过 `CHROMIUM_PATH` 指定本机 Chromium 路径（默认 `/usr/local/bin/chromium`）；应用需运行在 5180 端口。`render.py` 独立使用已打包素材，不依赖浏览器。

标题、检测框标注、胶卷意象和转场由视频合成，不代表网站界面的逐像素录屏。模板保留同一胶片参数，文字遮挡使用实际主体分割。影片没有演示原生 Apple Live Photo 编码，详见主 README 能力边界。

`score.wav` 为脚本合成的原创 100 BPM 电子音乐；Noto Sans SC 按 `FONT-LICENSE.txt` 分发。

节奏参考用户提供的 [QuanCard 产品短片](https://x.com/luoleiorg/status/2107481547242873319/video/1)，未使用参考片素材或音乐。
