# Quest 2D-to-3D Web Streaming Server (`quest-2d3d-web`)

独立的 2D转3D Web 视频流服务与 WebXR 播放器项目。
输入任意视频播放链接（MP4、HLS .m3u8、直播流等），服务端自动代理防盗链，前端通过 WebGL 视差着色器实时转换为 3D Side-by-Side (SBS) 视频流，并由 Meta Quest 官方浏览器原生识别与巨幕全屏播放。

## 🌟 特性

1. **用户自由输入播放链接**：支持用户在网页输入框中输入任意 `.m3u8` 或 `.mp4` 视频链接。
2. **服务端 CORS & 防盗链代理 (`/api/proxy`)**：Node.js Express 代理服务支持 `Range` 断点续传、跨域 CORS 头与 `Referer` 透传。
3. **WebGL 2D转3D 视差深度引擎**：基于亮度与焦平面收敛算法，实时生成左右眼立体 3D 画面。
4. **Canvas MediaStream 实时输出 (`canvas.captureStream`)**：将 3D 转换画面输出至 HTML5 原生 `<video controls data-stereo-mode="sbs">` 标签，触发 Quest 官方浏览器的原生 3D 全屏影院。

---

## 🚀 快速启动

### 1. 安装依赖

```bash
cd quest-2d3d-web
npm install
```

### 2. 启动服务

```bash
npm start
```

服务默认在 `http://localhost:3000` 或局域网 `http://<您的IP>:3000` 启动。

### 3. 在 Meta Quest 官方浏览器中使用

1. 打开 Meta Quest 官方浏览器 (Oculus Browser)。
2. 访问 `http://<您的电脑局域网IP>:3000`。
3. 粘贴任意视频链接（或点击“预置 3D 试听”按钮）。
4. 点击 **“▶ 开启 3D 播放”**，网页生成 3D 流后点击 **“📺 3D 原生视频全屏”**，即可在 Meta Quest 原生巨幕影院中体验 3D 立体画质！
