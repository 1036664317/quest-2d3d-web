// Quest 2D-to-3D WebXR MediaStream Core Engine
const videoInput = document.getElementById('video-input');
const sourceVideo = document.getElementById('source-video');
const convertedVideo = document.getElementById('converted-3d-video');
const canvas = document.getElementById('gl-canvas');
const guideMask = document.getElementById('start-guide-mask');
const toast = document.getElementById('toast');
const btnTogglePlay = document.getElementById('btn-toggle-play');
const timeDisplay = document.getElementById('time-display');
const seekBar = document.getElementById('seek-bar');

let hlsPlayer = null;
let gl = null;
let program = null;
let uEyeOffsetLoc = null;
let uParallaxIntensityLoc = null;
let texture = null;
let parallaxIntensity = 0.035;
let isStreamCaptured = false;
let isUserSeeking = false;

// 页面初始化
window.addEventListener('DOMContentLoaded', () => {
  videoInput.value = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
  setupCustomControlBarSync();
});

function loadPreset(url) {
  videoInput.value = url;
  handleStartPlayback();
}

// 绑定专属控制条与源视频的双向同步 (进度条、时间文字、播放状态)
function setupCustomControlBarSync() {
  sourceVideo.addEventListener('timeupdate', () => {
    if (!isUserSeeking && sourceVideo.duration) {
      const current = sourceVideo.currentTime || 0;
      const duration = sourceVideo.duration || 0;
      seekBar.value = (current / duration) * 100;
      updateTimeDisplay(current, duration);
    }
  });

  sourceVideo.addEventListener('loadedmetadata', () => {
    updateTimeDisplay(sourceVideo.currentTime || 0, sourceVideo.duration || 0);
  });

  sourceVideo.addEventListener('durationchange', () => {
    updateTimeDisplay(sourceVideo.currentTime || 0, sourceVideo.duration || 0);
  });

  sourceVideo.addEventListener('play', () => {
    if (btnTogglePlay) btnTogglePlay.innerText = '❚❚';
  });

  sourceVideo.addEventListener('pause', () => {
    if (btnTogglePlay) btnTogglePlay.innerText = '▶';
  });

  sourceVideo.addEventListener('ended', () => {
    if (btnTogglePlay) btnTogglePlay.innerText = '▶';
  });
}

function updateTimeDisplay(current, duration) {
  if (!timeDisplay) return;
  const fmtCurrent = formatTime(current);
  const fmtDuration = formatTime(duration);
  timeDisplay.innerText = `${fmtCurrent} / ${fmtDuration}`;
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const mm = m < 10 ? '0' + m : m;
  const ss = s < 10 ? '0' + s : s;
  return `${mm}:${ss}`;
}

// 拖拽进度条 Seek 交互处理
function onSeekInput(val) {
  isUserSeeking = true;
  if (sourceVideo.duration) {
    const targetTime = (val / 100) * sourceVideo.duration;
    sourceVideo.currentTime = targetTime;
    updateTimeDisplay(targetTime, sourceVideo.duration);
  }
}

function onSeekChange(val) {
  if (sourceVideo.duration) {
    const targetTime = (val / 100) * sourceVideo.duration;
    sourceVideo.currentTime = targetTime;
  }
  isUserSeeking = false;
}

// 播放 / 暂停 切换
function togglePlayPause() {
  if (!sourceVideo.src && !hlsPlayer) {
    handleStartPlayback();
    return;
  }

  if (sourceVideo.paused) {
    sourceVideo.play().then(() => {
      if (btnTogglePlay) btnTogglePlay.innerText = '❚❚';
    }).catch((e) => {
      console.warn('Play blocked:', e);
    });
  } else {
    sourceVideo.pause();
    if (btnTogglePlay) btnTogglePlay.innerText = '▶';
  }
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
    if (btnTogglePlay) btnTogglePlay.innerText = '❚❚';
  }).catch((err) => {
    console.log('Muted fallback play:', err);
    sourceVideo.muted = true;
    sourceVideo.play();
    initGlEngine();
    if (btnTogglePlay) btnTogglePlay.innerText = '❚❚';
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

// 捕获 WebGL 3D 画布流，推送到 3D 视频容器
function setupMediaStreamToVideo() {
  try {
    const stream = canvas.captureStream ? canvas.captureStream(60) : (canvas.mozCaptureStream ? canvas.mozCaptureStream(60) : null);
    if (stream) {
      const audioTracks = sourceVideo.captureStream ? sourceVideo.captureStream().getAudioTracks() : (sourceVideo.mozCaptureStream ? sourceVideo.mozCaptureStream().getAudioTracks() : []);
      if (audioTracks.length > 0) {
        stream.addTrack(audioTracks[0]);
      }
      convertedVideo.srcObject = stream;
      convertedVideo.play().then(() => {
        isStreamCaptured = true;
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

function toggleFullscreen() {
  const container = document.getElementById('player-viewport') || convertedVideo;
  if (container.requestFullscreen) container.requestFullscreen();
  else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
  else if (container.msRequestFullscreen) container.msRequestFullscreen();
}

function showToast(msg) {
  toast.innerText = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}
