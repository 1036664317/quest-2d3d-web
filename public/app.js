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

// 绑定原生 <video> 播放控件与 2D 源视频的真实属性代理 (总时长 duration / 当前进度 currentTime / Seek 可拖拽支持)
function setupNativeControlsSync() {
  try {
    // 1. 代理 duration 属性：让浏览器原生控件获取真实视频时长，激活可拖动进度条
    Object.defineProperty(convertedVideo, 'duration', {
      get: () => (sourceVideo && sourceVideo.duration && !isNaN(sourceVideo.duration)) ? sourceVideo.duration : 0,
      configurable: true
    });

    // 2. 代理 seekable 属性：向原生播放器声明该视频流全时段可拖动 Seeking
    Object.defineProperty(convertedVideo, 'seekable', {
      get: () => {
        const d = (sourceVideo && sourceVideo.duration && !isNaN(sourceVideo.duration)) ? sourceVideo.duration : 0;
        return {
          length: d > 0 ? 1 : 0,
          start: () => 0,
          end: () => d
        };
      },
      configurable: true
    });

    // 3. 代理 currentTime 属性读写：拖拽原生进度条时直接控制源视频寻帧
    Object.defineProperty(convertedVideo, 'currentTime', {
      get: () => (sourceVideo ? sourceVideo.currentTime || 0 : 0),
      set: (val) => {
        if (sourceVideo && typeof val === 'number' && !isNaN(val)) {
          sourceVideo.currentTime = val;
        }
      },
      configurable: true
    });
  } catch (e) {
    console.warn('Native controls proxy warning:', e);
  }

  // 4. 源视频事件透传给 convertedVideo 原生控件
  sourceVideo.addEventListener('loadedmetadata', () => {
    convertedVideo.dispatchEvent(new Event('loadedmetadata'));
    convertedVideo.dispatchEvent(new Event('durationchange'));
  });

  sourceVideo.addEventListener('durationchange', () => {
    convertedVideo.dispatchEvent(new Event('durationchange'));
  });

  sourceVideo.addEventListener('timeupdate', () => {
    convertedVideo.dispatchEvent(new Event('timeupdate'));
  });

  sourceVideo.addEventListener('seeking', () => {
    convertedVideo.dispatchEvent(new Event('seeking'));
  });

  sourceVideo.addEventListener('seeked', () => {
    convertedVideo.dispatchEvent(new Event('seeked'));
  });

  convertedVideo.addEventListener('play', () => {
    if (sourceVideo.paused) sourceVideo.play().catch(() => {});
  });

  convertedVideo.addEventListener('pause', () => {
    if (!sourceVideo.paused) sourceVideo.pause();
  });

  sourceVideo.addEventListener('ended', () => {
    convertedVideo.pause();
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
  // 手势回调内同步触发播放
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
        showToast('✨ 3D 视差视频流已挂载，原生进度条已可拖拽！');
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
