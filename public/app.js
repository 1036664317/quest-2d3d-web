// Quest 2D-to-3D WebXR Engine
const videoInput = document.getElementById('video-input');
const sourceVideo = document.getElementById('source-video');
const canvas = document.getElementById('gl-canvas');
const guideMask = document.getElementById('start-guide-mask');
const toast = document.getElementById('toast');

const btnPlayPause = document.getElementById('btn-play-pause');
const timeDisplay = document.getElementById('time-display');
const seekBar = document.getElementById('seek-bar');
const btnMute = document.getElementById('btn-mute');

let hlsPlayer = null;
let gl = null;
let program = null;
let uEyeOffsetLoc = null;
let uParallaxIntensityLoc = null;
let texture = null;
let parallaxIntensity = 0.035;
let isSeekingUser = false;

// 页面初始化
window.addEventListener('DOMContentLoaded', () => {
  videoInput.value = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
  initPlayerSync();
});

function initPlayerSync() {
  sourceVideo.addEventListener('timeupdate', () => {
    if (!isSeekingUser && sourceVideo.duration) {
      const pct = (sourceVideo.currentTime / sourceVideo.duration) * 100;
      seekBar.value = pct;
      updateTimeDisplay();
    }
  });

  sourceVideo.addEventListener('loadedmetadata', updateTimeDisplay);
  sourceVideo.addEventListener('durationchange', updateTimeDisplay);

  sourceVideo.addEventListener('play', () => {
    btnPlayPause.innerText = '⏸';
  });

  sourceVideo.addEventListener('pause', () => {
    btnPlayPause.innerText = '▶';
  });

  seekBar.addEventListener('input', () => {
    isSeekingUser = true;
    if (sourceVideo.duration) {
      const cur = (seekBar.value / 100) * sourceVideo.duration;
      timeDisplay.innerText = `${formatTime(cur)} / ${formatTime(sourceVideo.duration)}`;
    }
  });

  seekBar.addEventListener('change', () => {
    if (sourceVideo.duration) {
      sourceVideo.currentTime = (seekBar.value / 100) * sourceVideo.duration;
    }
    isSeekingUser = false;
  });
}

function updateTimeDisplay() {
  const cur = sourceVideo.currentTime || 0;
  const dur = sourceVideo.duration || 0;
  timeDisplay.innerText = `${formatTime(cur)} / ${formatTime(dur)}`;
}

function formatTime(sec) {
  if (isNaN(sec) || !isFinite(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function togglePlayPause() {
  if (sourceVideo.paused) {
    sourceVideo.play().catch(() => {});
  } else {
    sourceVideo.pause();
  }
}

function toggleMute() {
  sourceVideo.muted = !sourceVideo.muted;
  btnMute.innerText = sourceVideo.muted ? '🔇' : '🔊';
}

function toggleViewportFullscreen() {
  const vp = document.getElementById('player-viewport');
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (vp.requestFullscreen) vp.requestFullscreen();
    else if (vp.webkitRequestFullscreen) vp.webkitRequestFullscreen();
    else if (vp.msRequestFullscreen) vp.msRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}

function loadPreset(url) {
  videoInput.value = url;
  handleStartPlayback();
}

function handleStartPlayback() {
  const rawUrl = videoInput.value.trim();
  if (!rawUrl) {
    showToast('❌ 请输入有效的视频链接！');
    return;
  }

  guideMask.style.display = 'none';
  showToast('🚀 正在生成 3D 视差立体流...');

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
  sourceVideo.play().then(() => {
    initGlEngine();
    showToast('✨ 3D 视差视频流就绪，全屏呈现 3D SBS 影院！');
  }).catch((err) => {
    console.log('Muted fallback play:', err);
    sourceVideo.muted = true;
    btnMute.innerText = '🔇';
    sourceVideo.play();
    initGlEngine();
  });
}

// WebGL 2D转3D 深度视差渲染引擎
function initGlEngine() {
  if (gl) return;
  gl = canvas.getContext('webgl', { alpha: true, preserveDrawingBuffer: true }) ||
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
