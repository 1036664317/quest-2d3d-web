# 🎬 3D 沉浸影院 (2D-to-3D Web Streaming Server)

> 🚀 **任意 2D 视频流实时转换 3D 左右立体（Side-by-Side SBS）影院**  
> 基于 WebGL 深度视差算法，支持全量 HTML5 原生播放控件、拖拽进度条 Seek、CORS 防盗链代理与 Vercel 一键云端 Serverless 部署。

---

## ✨ 核心特性

- 🥽 **WebGL 实时 2D转3D 视差引擎**：基于光学亮度（Luminance）与焦平面收敛算法（Radial Depth Gradient），实时计算前景凸出与背景沉陷，实现自然真实的 3D 纵深体验。
- 📺 **原生 HTML5 `<video controls>` 极简界面**：保留浏览器原汁原味的播放控制条、音量调整与原生全屏按钮，全屏直接触发 VR 头显/3D 设备的 **原生 3D VR 影院模式**。
- ⏱️ **外置 3D 可拖拽 Seek 进度条**：带实时时间指示（`00:20 / 09:56`），支持全量点按与滑块拖拽快进/快退，100% 不干扰 3D 视频流。
- ✨ **动态 3D 视差深度微调**：页面右上角悬浮“3D 视差深度”调节滑块与“视差增强”按钮，可实时平滑调整立体深浅度。
- 🔄 **CORS & 防盗链 & 301 重定向代理**：内置 `/api/proxy` 端点，支持 HLS（`.m3u8`）、MP4、直播流等跨域解包、`Range` 断点续传与 HTTP 重定向。
- ☁️ **Vercel Serverless 原生开箱即用**：自带 [api/proxy.js](api/proxy.js) 与 [vercel.json](vercel.json)，支持直接一键部署至 Vercel 免费 Serverless 节点。

---

## 📁 项目目录结构

```text
quest-2d3d-web/
├── api/
│   └── proxy.js          # Vercel Serverless 云端跨域/重定向视频代理函数
├── public/
│   ├── index.html        # 主界面 HTML (包含 3D 视差画布与原生视频控件)
│   ├── app.js            # 核心 WebGL 3D 着色器引擎、媒体流与 Seek 进度同步
│   └── style.css         # 暗黑玻璃拟态响应式 CSS 样式表
├── server.js             # 本地 Express Node.js 开发/生产服务器
├── vercel.json           # Vercel 部署路由配置文件
├── package.json          # 项目依赖与脚本定义
└── README.md             # 项目说明文档
```

---

## 🚀 快速启动

### 1. 克隆与安装依赖

```bash
git clone https://github.com/1036664317/quest-2d3d-web.git
cd quest-2d3d-web
npm install
```

### 2. 本地启动服务

```bash
npm start
# 或使用 dev 模式
npm run dev
```

控制台输出：
```text
=======================================================
 2D-to-3D Web Cinema Server Started Successfully!      
 Access URL: http://localhost:3000                  
 Open this URL in any 3D/VR Browser for 3D VR Mode!    
=======================================================
```

在浏览器打开 `http://localhost:3000` 即可体验！

---

## ☁️ Vercel 一键部署

本项目专为 Vercel 进行了云端 Serverless 架构设计，支持一键部署到公网 HTTPS：

### 方法 1：通过 GitHub 导入一键部署（推荐）

1. 将本项目 Commit 并 Push 至您的 GitHub 仓库。
2. 登录 [Vercel 官网](https://vercel.com/)。
3. 点击 **"Add New..."** -> **"Project"**，选择该 GitHub 仓库。
4. 保持默认 Build & Directory 设置，点击 **"Deploy"** 即可生成免费的 HTTPS 域名（例如 `https://your-app.vercel.app`）。

### 方法 2：使用 Vercel CLI 命令行部署

在项目根目录下运行：

```bash
cmd /c npx vercel
```
根据终端提示登录账户并连续按回车，几秒内即可获得公网访问地址。发布正式生产版本请运行：
```bash
cmd /c npx vercel --prod
```

---

## 🥽 VR / 3D 头显使用指南

适用于 Meta Quest 1/2/3/Pro、Pico 4/Ultra、Apple Vision Pro、3D 显示器等设备：

1. 在 VR 头显自带浏览器中打开部署的网址（或电脑局域网 IP `http://<电脑IP>:3000`）。
2. 输入任意视频链接（或点击“预置 3D 试听”按钮，如 Big Buck Bunny）。
3. 点击 **“▶ 播放”**，画面将实时转换为左右 3D 立体 SBS 视差流。
4. 点击视频右下角的 **原生全屏按钮 ⛶**，浏览器将自动唤起设备自带的 **原生 3D VR 巨幕影院**。
5. 画面上方可通过 **3D 视差深度** 滑块微调立体出框感。

---

## 🛠️ 技术栈

- **前端核心**：HTML5, Vanilla JavaScript (ES6+), WebGL 1.0/2.0
- **3D 深度着色器**：Custom GLSL Fragment Shader (Luminance + Radial Convergence)
- **媒体处理**：Hls.js, HTML5 MediaStream API
- **后端 / 代理**：Node.js, Express, Vercel Serverless Functions (`@vercel/node`)

---

## ⚠️ 免责声明与非商业协议

1. **仅供个人学习交流与研究使用**：本项目仅供个人学习 WebGL、WebXR 视差算法与音视频技术研究使用，**严禁任何形式的商业用途、二次售卖、付费打包、商业化付费服务或盈利行为**。
2. **版权归属说明**：所有输入的音视频流版权归其原始作者及平台所有，本项目不储存、不传播任何版权音视频资源，仅提供前端视差转换渲染技术演示。

---

## 📄 开源协议

本项目基于 **CC BY-NC-SA 4.0 (知识共享 署名-非商业性使用-相同方式共享 4.0 国际许可协议)** 开源发布。

- ❌ **严禁商用**：不可将本代码、衍生版本或基于本项目的服务用于任何形式的商业盈利。
- 允许个人非商业性使用、学习、修改与分享，分发衍生作品须保留原作者署名并采用相同协议。
