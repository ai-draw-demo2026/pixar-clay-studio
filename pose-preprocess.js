/**
 * 姿态预处理模块（基于 TensorFlow.js + MoveNet）
 *
 * 对上传的图片进行人体关键点检测，在原始图上绘制骨架连线，
 * 返回叠加后的 base64 图像。该图像送入 Canny ControlNet 后，
 * 骨架线会形成强边缘，帮助模型锁定正确的人体姿态。
 *
 * MoveNet 检测 17 个 COCO 关键点：鼻、眼、耳、肩、肘、腕、髋、膝、踝
 * 不包含手指级检测，但肘/腕锁定就能显著改善肢体变形问题。
 */

const tf = require("@tensorflow/tfjs-node");
const poseDetection = require("@tensorflow-models/pose-detection");
const { createCanvas, loadImage } = require("canvas");

// ==============================
// COCO 骨架连线（17 关键点）
// ==============================
// 关键点索引：
//   0=鼻  1=左眼  2=右眼  3=左耳  4=右耳
//   5=左肩  6=右肩  7=左肘  8=右肘  9=左腕  10=右腕
//   11=左髋  12=右髋  13=左膝  14=右膝  15=左踝  16=右踝
const SKELETON_CONNECTIONS = [
  // 面部
  [0, 1], [1, 3],  // 鼻→左眼→左耳
  [0, 2], [2, 4],  // 鼻→右眼→右耳
  // 躯干
  [5, 6],  // 左右肩
  [5, 11], // 左肩→左髋
  [6, 12], // 右肩→右髋
  [11, 12], // 左右髋
  // 左臂
  [5, 7], [7, 9],  // 肩→肘→腕
  // 右臂
  [6, 8], [8, 10], // 肩→肘→腕
  // 左腿
  [11, 13], [13, 15], // 髋→膝→踝
  // 右腿
  [12, 14], [14, 16], // 髋→膝→踝
];

// 指尖/肢体末端关键点（画大圆圈高亮）
const ENDPOINTS = [9, 10, 15, 16]; // 左腕、右腕、左踝、右踝

// 手臂/手腕连线加粗（手部锁定更稳）
const HAND_CONNECTIONS = [
  [5, 7], [7, 9],  // 左肩→左肘→左腕
  [6, 8], [8, 10], // 右肩→右肘→右腕
];

// ==============================
// 模块级单例（惰性初始化）
// ==============================
let _detector = null;
let _initializing = false;

async function getDetector() {
  if (_detector) return _detector;
  if (_initializing) {
    // 如果正在初始化，等待完成
    while (_initializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return _detector;
  }
  _initializing = true;
  try {
    // MoveNet Lightning — 轻量快速，适合服务端
    _detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
    _initializing = false;
    return _detector;
  } catch (err) {
    _initializing = false;
    throw err;
  }
}

// ==============================
// 绘图工具
// ==============================

function drawSkeleton(ctx, keypoints, w, h, color, lineWidth) {
  if (!keypoints || keypoints.length === 0) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [i, j] of SKELETON_CONNECTIONS) {
    const p1 = keypoints[i];
    const p2 = keypoints[j];
    if (!p1 || !p2) continue;
    if (p1.score != null && p1.score < 0.3) continue;
    if (p2.score != null && p2.score < 0.3) continue;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // 手臂/手腕连线加粗，强化 Canny 对手部位置的边缘检测
  ctx.lineWidth = lineWidth * 2;
  ctx.strokeStyle = "#ff4488"; // 亮粉色，与主骨架颜色区分
  for (const [i, j] of HAND_CONNECTIONS) {
    const p1 = keypoints[i];
    const p2 = keypoints[j];
    if (!p1 || !p2) continue;
    if (p1.score != null && p1.score < 0.3) continue;
    if (p2.score != null && p2.score < 0.3) continue;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
}

function drawKeypoints(ctx, keypoints, w, h, color, radius) {
  if (!keypoints || keypoints.length === 0) return;

  ctx.fillStyle = color;

  for (let k = 0; k < keypoints.length; k++) {
    const p = keypoints[k];
    if (!p) continue;
    if (p.score != null && p.score < 0.3) continue;

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 高亮末端（腕、踝）
  ctx.fillStyle = "#ffffff";
  for (const ei of ENDPOINTS) {
    const p = keypoints[ei];
    if (!p) continue;
    if (p.score != null && p.score < 0.3) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 手腕额外放大（前两个 ENDPOINTS = 9,10）
  ctx.fillStyle = "#ff4488";
  for (let wi = 0; wi < 2 && wi < ENDPOINTS.length; wi++) {
    const p = keypoints[ENDPOINTS[wi]];
    if (!p) continue;
    if (p.score != null && p.score < 0.3) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ==============================
// 主处理函数
// ==============================

/**
 * 对 base64 图片进行姿态检测，绘制骨架叠加图
 *
 * @param {string} base64Data - data:image/...;base64,... 格式的图片
 * @param {object} [options]
 * @param {string} [options.skeletonColor="#00ff88"] - 骨架连线颜色
 * @param {number} [options.opacity=0.55] - 骨架叠加透明度
 * @returns {Promise<string>} 处理后的 base64 PNG
 */
async function preprocessImage(base64Data, options = {}) {
  const {
    skeletonColor = "#00ff88",
    opacity = 0.55,
  } = options;

  // 1. 解析 base64 → Buffer
  const raw = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(raw, "base64");

  // 2. 加载图片
  const img = await loadImage(buf);
  const w = img.width;
  const h = img.height;

  // 3. 创建 canvas
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  // 4. 运行姿态检测
  try {
    const detector = await getDetector();

    // @tensorflow/tfjs-node: 直接用 decodeImage 从 Buffer 解码
    const tensor = tf.node.decodeImage(buf, 3);
    const poses = await detector.estimatePoses(tensor);
    tf.dispose(tensor);

    if (poses && poses.length > 0) {
      const keypoints = poses[0].keypoints;

      // 创建骨架叠加层
      const overlay = createCanvas(w, h);
      const octx = overlay.getContext("2d");

      drawSkeleton(octx, keypoints, w, h, skeletonColor, 4);
      drawKeypoints(octx, keypoints, w, h, skeletonColor, 5);

      // 半透明度叠加
      ctx.globalAlpha = opacity;
      ctx.drawImage(overlay, 0, 0);
      ctx.globalAlpha = 1.0;

      const detectedCount = keypoints.filter(k => k.score != null && k.score >= 0.3).length;
      console.log(`      → 检测到 ${detectedCount}/17 个关键点`);
    } else {
      console.log("      → 未检测到人体姿态");
    }
  } catch (err) {
    console.warn("[pose-preprocess] 姿态检测失败:", err.message);
    // 非致命：返回原图
  }

  // 5. 导出为 base64 PNG
  return canvas.toBuffer("image/png").toString("base64");
}

module.exports = { preprocessImage };
