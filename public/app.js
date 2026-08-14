// Quest 2D-to-3D WebXR MediaStream Core Engine
const videoInput = document.getElementById('video-input');
const sourceVideo = document.getElementById('source-video');
const convertedVideo = document.getElementById('converted-3d-video');
const canvas = document.getElementById('gl-canvas');
const guideMask = document.getElementById('start-guide-mask');
const toast = document.getElementById('toast');

let hlsPlayer = null;
let gl = null;
let program = null;
let uEyeOffsetLoc = null;
let uParallaxIntensityLoc = null;
let texture = null;
let parallaxIntensity = 0.035;
let isStreamCaptured = false;
let mediaStream = null;

// 页面初始化
window.addEventListener('DOMContentLoaded', () => {
  videoInput.value = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
  setupNativeControlsSync();
});

function loadPreset(url) {
  videoInput.value = url;
  handleStartPlayback();
}

// 绑定原生 <video> 播放控件与 2D 源视频的精确双向同步 (解决 MediaStream 无法拖拽进度条的问题)
function setupNativeControlsSync() {
  // 重写 convertedVideo 的关键媒体属性，使其从 MediaStream 的 Infinity 转为返回源视频的实际时长与进度
  try {
    Object.defineProperty(convertedVideo, 'duration', {
      get: () => {
        const d = sourceVideo.duration;
        return (d && !isNaN(d) && isFinite(d)) ? d : 0;
      },
      configurable: true
    });

    Object.defineProperty(convertedVideo, 'currentTime', {
      get: () => sourceVideo.currentTime || 0,
      set: (val) => {
        sourceVideo.currentTime = val;
      },
      configurable: true
    });

    Object.defineProperty(convertedVideo, 'paused', {
      get: () => sourceVideo.paused,
      configurable: true
    });

    Object.defineProperty(convertedVideo, 'ended', {
      get: () => sourceVideo.ended,
      configurable: true
    });

    Object.defineProperty(convertedVideo, 'seeking', {
      get: () => sourceVideo.seeking,
      configurable: true
    });
  } catch (e) {
    console.warn('Property override fallback:', e);
  }

  // 将 sourceVideo 的媒体事件（loadedmetadata, durationchange, timeupdate 等）实时转发给 convertedVideo
  // 这会直接刷新浏览器原生播放控件的进度条与时间刻度
  const eventsToForward = [
    'loadedmetadata',
    'durationchange',
    'timeupdate',
    'play',
    'playing',
    'pause',
    'seeking',
    'seeked',
    'waiting',
    'ended'
  ];

  eventsToForward.forEach((eventName) => {
    sourceVideo.addEventListener(eventName, () => {
      try {
        convertedVideo.dispatchEvent(new Event(eventName));
      } catch (e) {}
    });
  });

  // 用户点击原生控制条 Play/Pause 时同步源视频
  convertedVideo.addEventListener('play', () => {
    if (sourceVideo.paused) sourceVideo.play().catch(() => {});
  });

  convertedVideo.addEventListener('pause', () => {
    if (!sourceVideo.paused) sourceVideo.pause();
  });
}

function handleStartPlayback() {
  const rawUrl = videoInput.value.trim();
  if (!rawUrl) {
    showToast('❌ 请输入有效的视频链接！');
    return;
  }

  guideMask.style.display = 'none';
  showToast('🚀 正在生成 3D 视差立体流...');

  // 使用本地代理接口
  const proxiedUrl = `/api/proxy?url=${encodeURIComponent(rawUrl)}`;
  loadVideoToSource(proxiedUrl, rawUrl);
}

function loadVideoToSource(streamUrl, rawUrl) {
  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }

  const isHls = (Hls.isSupported() && (rawUrl.includes('.m3u8') || streamUrl.includes('.m3u8')));

  if (isHls) {
    hlsPlayer = new Hls({
      xhrSetup: (xhr, url) => {
        xhr.withCredentials = false;
      }
    });
    hlsPlayer.loadSource(streamUrl);
    hlsPlayer.attachMedia(sourceVideo);
    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
      startPlaybackAndGL();
    });
    hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.warn('HLS Proxy fallback to raw url:', data);
        hlsPlayer.destroy();
        hlsPlayer = new Hls();
        hlsPlayer.loadSource(rawUrl);
        hlsPlayer.attachMedia(sourceVideo);
        startPlaybackAndGL();
      }
    });
  } else {
    sourceVideo.src = streamUrl;
    startPlaybackAndGL();
  }
}

function startPlaybackAndGL() {
  // 手势回调内同时触发 sourceVideo 与 convertedVideo 的播放
  sourceVideo.play().then(() => {
    initGlEngine();
  }).catch((err) => {
    console.log('Muted fallback play:', err);
    sourceVideo.muted = true;
    sourceVideo.play();
    initGlEngine();
  });
}

// WebGL 2D转3D 深度视差渲染引擎
function initGlEngine() {
  if (gl) return;
  gl = canvas.getContext('webgl', { xrCompatible: true, preserveDrawingBuffer: true }) ||
       canvas.getContext('experimental-webgl');
  if (!gl) return;

  const vsSource = `
    attribute vec2 aPosition;
    attribute vec2 aTexCoord;
    varying vec2 vTexCoord;
    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
      vTexCoord = aTexCoord;
    }
  `;

  // 亮度 + 焦平面收敛 3D 深度视差着色器
  const fsSource = `
    precision mediump float;
    uniform sampler2D uSampler;
    uniform float uEyeOffset;
    uniform float uParallaxIntensity;
    varying vec2 vTexCoord;

    void main() {
      vec2 coord = vTexCoord;
      vec4 centerTex = texture2D(uSampler, coord);
      
      // 光学深度计算 (Luminance + Radial Depth Gradient)
      float lum = dot(centerTex.rgb, vec3(0.299, 0.587, 0.114));
      vec2 centerDist = coord - vec2(0.5, 0.5);
      float dist = length(centerDist);
      float depthMap = clamp(lum * 0.65 + (1.0 - dist * 0.7) * 0.35, 0.0, 1.0);
      
      // 前景凸出，背景深陷
      float offset = uEyeOffset * uParallaxIntensity * (depthMap - 0.42);
      coord.x = clamp(coord.x + offset, 0.001, 0.999);
      
      gl_FragColor = texture2D(uSampler, coord);
    }
  `;

  function createShader(gl, type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  }

  program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  gl.useProgram(program);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

  const texBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,1, 1,1, 0,0, 0,0, 1,1, 1,0]), gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(posLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const texLoc = gl.getAttribLocation(program, 'aTexCoord');
  gl.enableVertexAttribArray(texLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
  gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

  texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  uEyeOffsetLoc = gl.getUniformLocation(program, 'uEyeOffset');
  uParallaxIntensityLoc = gl.getUniformLocation(program, 'uParallaxIntensity');

  function renderLoop() {
    render3DSBSCanvas();
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);
}

function render3DSBSCanvas() {
  if (sourceVideo.readyState >= sourceVideo.HAVE_CURRENT_DATA) {
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceVideo);
    } catch (e) {}

    if (sourceVideo.videoWidth && sourceVideo.videoHeight) {
      if (canvas.width !== sourceVideo.videoWidth * 2) {
        canvas.width = sourceVideo.videoWidth * 2;
        canvas.height = sourceVideo.videoHeight;
      }
    }

    const w = canvas.width;
    const h = canvas.height;
    const halfW = w / 2;

    gl.useProgram(program);

    // 左眼视口 (Left Eye)
    gl.viewport(0, 0, halfW, h);
    gl.uniform1f(uEyeOffsetLoc, -1.0);
    gl.uniform1f(uParallaxIntensityLoc, parallaxIntensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 右眼视口 (Right Eye)
    gl.viewport(halfW, 0, halfW, h);
    gl.uniform1f(uEyeOffsetLoc, 1.0);
    gl.uniform1f(uParallaxIntensityLoc, parallaxIntensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (!isStreamCaptured) {
      setupMediaStreamToVideo();
    }
  }
}

// 捕获 WebGL 3D 画布流，直接推送到具有浏览器原生控件的 <video id="converted-3d-video">
function setupMediaStreamToVideo() {
  try {
    mediaStream = canvas.captureStream ? canvas.captureStream(60) : (canvas.mozCaptureStream ? canvas.mozCaptureStream(60) : null);
    if (mediaStream) {
      // 提取源视频音轨合并入 3D 视频流
      const audioTracks = sourceVideo.captureStream ? sourceVideo.captureStream().getAudioTracks() : (sourceVideo.mozCaptureStream ? sourceVideo.mozCaptureStream().getAudioTracks() : []);
      if (audioTracks.length > 0) {
        mediaStream.addTrack(audioTracks[0]);
      }
      convertedVideo.srcObject = mediaStream;
      convertedVideo.play().then(() => {
        isStreamCaptured = true;
        showToast('✨ 3D 视差视频流已挂载，支持原生可拖拽进度条！');
      }).catch((e) => {
        console.log('convertedVideo play catch:', e);
        isStreamCaptured = true;
      });
    }
  } catch (e) {
    console.error('Canvas captureStream error:', e);
  }
}

function onParallaxSliderChange(val) {
  parallaxIntensity = (val / 1000.0);
  document.getElementById('parallax-val').innerText = val;
}

function boost3DDepth() {
  parallaxIntensity = 0.065;
  document.getElementById('parallax-range').value = 65;
  document.getElementById('parallax-val').innerText = '65';
  showToast('✨ 3D 视差强度已增强到极致');
}

function showToast(msg) {
  toast.innerText = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}
