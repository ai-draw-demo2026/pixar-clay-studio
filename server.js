require("dotenv").config({ override: true });

// ==============================
// 全局异常兜底：捕获未处理错误，防止进程崩溃
// ==============================
process.on("uncaughtException", (err) => {
  console.error("[全局] 未捕获异常:", err.message, err.stack?.split("\n").slice(0, 3).join(" "));
});
process.on("unhandledRejection", (reason) => {
  console.error("[全局] 未处理的 Promise 拒绝:", reason?.message || reason);
});

const express = require("express");
const app = express();

const path = require("path");
const https = require("https");
const fs = require("fs");
const { preprocessImage } = require("./pose-preprocess");

// ==============================
// Gallery 存储（JSON 文件）
// ==============================
const GALLERY_FILE = path.join(__dirname, "gallery.json");
const GALLERY_MAX = 100;

function loadGallery() {
  try {
    if (fs.existsSync(GALLERY_FILE)) {
      return JSON.parse(fs.readFileSync(GALLERY_FILE, "utf-8"));
    }
  } catch (e) { /* ignore corrupt file */ }
  return [];
}

function saveGallery(records) {
  try {
    fs.writeFileSync(GALLERY_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch (e) {
    console.error("[Gallery] 写入失败:", e.message);
  }
}

function addGalleryRecord(record) {
  const records = loadGallery();
  records.unshift(record);
  if (records.length > GALLERY_MAX) records.length = GALLERY_MAX;
  saveGallery(records);
}

// 请求体上限放大，因为 base64 图片很大
app.use(express.json({ limit: "50mb" }));

// CORS：允许来自任意来源的请求（适配 CCOnline 代理转发）
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// 托管前端静态文件
app.use(express.static(path.join(__dirname, ".")));

// ==============================
// LiblibAI 配置
// ==============================
const LIBLIBAI_ACCESS_KEY = process.env.LIBLIBAI_ACCESS_KEY;
const LIBLIBAI_SECRET_KEY = process.env.LIBLIBAI_SECRET_KEY;
if (!LIBLIBAI_ACCESS_KEY || !LIBLIBAI_SECRET_KEY) {
  console.error("错误: 请在 .env 中配置 LIBLIBAI_ACCESS_KEY 和 LIBLIBAI_SECRET_KEY");
  process.exit(1);
}

const { LiblibAI } = require("liblibai");
const client = new LiblibAI({
  apiKey: LIBLIBAI_ACCESS_KEY,
  apiSecret: LIBLIBAI_SECRET_KEY,
});

// img2img 参数模板 — 必须支持图生图的模板
const IMG2IMG_TEMPLATE_UUID = "9c7d531dc75f476aa833b3d452b8f7ad";

// ControlNet 模型版本 UUID（留空则不启用 ControlNet）
const CONTROLNET_MODEL_UUID = process.env.CONTROLNET_MODEL_UUID || "";
const OPENPOSE_MODEL_UUID = process.env.OPENPOSE_MODEL_UUID || "";

// === IP-Adapter FaceID（SDXL人脸锁定） ===
const IPADAPTER_MODEL_UUID = process.env.IPADAPTER_MODEL_UUID || "";
const IPADAPTER_ENABLED = !!IPADAPTER_MODEL_UUID;

// === SDXL LoRA 配置清单 ===
// 每个 LoRA 的权重分三档，与 denoising 档位联动
const LORA_DB = {
  clay: {  // Clay Word:黏土滤镜风格XL（主链路默认）
    uuid: "9b04646c89c848148df28433af632eda",
    weights: { portrait: 0.2, normal: 0.25, strong: 0.3 },
    trigger: "niantu,masterpiece,best quality",
    desc: "皮克斯黏土（默认）",
  },
  qclay: {  // Qclay_XL_V2.0
    uuid: "a95bc41f4d10466bba633dcd0143155f",
    weights: { portrait: 0.7, normal: 0.7, strong: 0.7 },
    trigger: "Qclay",
    faceWeight: 0.65,
    desc: "Q版黏土人偶",
  },
  food: {  // Fooooding_XL_黏土浮雕画手工（背景增强）
    uuid: "85a7362bf1144b9a9ca0675f1e4d057e",
    weights: { portrait: 0.4, normal: 0.4, strong: 0.4 },
    trigger: "clay relief,clay art,handmade",
    desc: "背景黏土浮雕",
  },
  carton: {  // SDXL卡通3D形象盲盒手办
    uuid: "5ea847aa8e834f8ca9f76006a0309858",
    weights: { portrait: 0.83, normal: 0.83, strong: 0.83 },
    trigger: "",
    desc: "手办（硬质PVC）",
  },
  pvc: {  // PVC盲盒手办
    uuid: "723c7db093e04cb7837ea921a0129d71",
    weights: { portrait: 0.8, normal: 0.8, strong: 0.8 },
    trigger: "",
    desc: "手办（二次元）",
  },
};

// ==============================
// 强制转化型提示词（强黏土人偶化）
// ==============================

// 身份保留短句（锁住人脸/手势/构图）
const IDENTITY_FIX =
  "strictly preserve original person's face, gender, age, facial features, hairstyle, " +
  "gesture, hand pose, body position, composition, relative spacing between people, " +
  "clothing colors and patterns, ";

// 材质强制转化：每样东西都必须变成黏土玩偶
const CLAY_MANDATE =
  "THIS IS A PIXAR CLAY STOP-MOTION DOLL. Convert entire person into a clay stop-motion puppet. " +
  "Not a real human. 哑光黏土泥塑材质, entire body is matte clay sculpted material. " +
  "皮肤带有细腻黏土肌理，手工捏塑痕迹明显, skin has fine clay sculpting texture with hand-sculpting marks. " +
  "头发必须是整块黏土雕刻的发片，不能有真实发丝纹理、不能有飘散单根发丝，发丝纹理是黏土雕刻纹路而非真实毛发生长质感, " +
  "hair must be solid clay-sculpted sheets with carved strand纹理, no real hair strands, no flyaway hairs, " +
  "衣物为黏土手工捏制，带有起伏纹路, clothes are hand-sculpted clay with undulating fold marks. " +
  "柔和黏土漫反射光影，无真实肤质高光, warm matte clay diffuse lighting, no skin highlights. " +
  "skin = matte clay sculpt, hair = solid clay chunks, clothes = carved clay fabric. " +
  "物体边缘圆润, all edges rounded. background = clay diorama. " +
  "hand-sculpting texture on all surfaces, fingers cleanly separated. " +
  "整体为3D皮克斯黏土人偶，每个细节均为黏土手工捏制. " +
  "画面所有物体统一黏土泥塑材质，全部元素拥有黏土肌理，禁止局部写实摄影质感, " +
  "unified clay sculpt material across entire image, every element has clay texture, no局部 realistic patches, ";

// 约束后缀
const CONSTRAINT_SUFFIX =
  "no real human skin texture, no real hair strands, no fabric weave remaining, " +
  "no flat painted background, no extra accessories, no identity change, " +
  "禁止真实皮肤质感, 禁止原生发丝, 禁止针织布料残留, 禁止写实高光, " +
  "no realistic skin pores, no glossy highlights, no photographic lighting, " +
  "no fabric luster, no wet sheen, no metallic gloss, ";

const CONSTRAINT_TEMPLATE = IDENTITY_FIX + CLAY_MANDATE + CONSTRAINT_SUFFIX;

// ==============================
// 工具：上传 base64 图片到 LiblibAI OSS
// ==============================
async function uploadImage(base64Data) {
  // base64 → Buffer
  const raw = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(raw, "base64");

  const filename = `upload_${Date.now()}.png`;

  // 1. 获取 OSS 签名
  const signData = await client.signFile(filename);

  // 2. 上传到 OSS（SDK 的 uploadFile 有字段名大小写 bug，手动上传）
  const formData = new FormData();
  formData.append("x-oss-signature", signData.xOssSignature);
  formData.append("x-oss-date", signData.xOssDate);
  formData.append("x-oss-signature-version", signData.xOssSignatureVersion);
  formData.append("policy", signData.policy);
  formData.append("key", signData.key);
  formData.append("x-oss-credential", signData.xOssCredential);
  formData.append("x-oss-expires", signData.xOssExpires.toString());
  const blob = new Blob([new Uint8Array(buf)], { type: "image/png" });
  formData.append("file", blob, filename);

  const resp = await fetch(signData.postUrl, { method: "POST", body: formData });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OSS 上传失败 (${resp.status}): ${text.slice(0, 200)}`);
  }

  return new URL(signData.key, signData.postUrl).toString();
}

// ==============================
// 连通性测试端点
// ==============================
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// 全局请求锁：一次只处理一个生成，防止 API 拒绝并发
let _generating = false;
const _generateQueue = [];

async function waitForTurn() {
  if (!_generating) { _generating = true; return; }
  await new Promise((resolve) => _generateQueue.push(resolve));
  _generating = true;
}
function releaseTurn() {
  _generating = false;
  if (_generateQueue.length > 0) {
    const next = _generateQueue.shift();
    next();
  }
}

// ==============================
// 异步任务存储
// ==============================
const taskStore = new Map();
let taskIdCounter = 0;

// ==============================
// 异步生成接口：立刻返回 taskId
// ==============================
app.post("/api/generate", (req, res) => {
  const { image, prompt: userStyle, strength, style_strength, negative_prompt, width, height, mode, background_enhance, pose_preprocess, enable_faceid, face_image } = req.body;

  // 参数校验
  if (!userStyle) {
    return res.status(400).json({ error: "prompt 不能为空" });
  }
  if (!image) {
    return res.status(400).json({ error: "请上传参考图片" });
  }

  const taskId = `task_${++taskIdCounter}_${Date.now()}`;
  const task = {
    id: taskId,
    status: "queued",      // queued → processing → done / error
    result: null,
    error: null,
    createdAt: Date.now(),
  };
  taskStore.set(taskId, task);

  console.log(`[异步] 任务 ${taskId} 已入队`);
  res.json({ taskId });

  // 后台执行生成（不阻塞响应）
  runGenerate(taskId, {
    image, userStyle, strength, style_strength,
    negative_prompt, width, height, mode,
    background_enhance, pose_preprocess,
    enable_faceid, face_image,
  });
});

// ==============================
// 结果查询接口
// ==============================
app.get("/api/result/:taskId", (req, res) => {
  const task = taskStore.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: "任务不存在" });
  }
  if (task.status === "done") {
    return res.json({ status: "done", meta: task.result.meta });
  }
  if (task.status === "error") {
    return res.json({ status: "error", error: task.error });
  }
  res.json({ status: "processing" });
});

// ==============================
// 图片代理接口（解决 CCOnline 拦截外部 CDN 图片的问题）
// ==============================
app.get("/api/image/:taskId", async (req, res) => {
  const task = taskStore.get(req.params.taskId);
  if (!task || task.status !== "done" || !task.result?.imageUrl) {
    return res.status(404).json({ error: "图片不存在" });
  }
  try {
    const imgResp = await fetch(task.result.imageUrl);
    if (!imgResp.ok) {
      return res.status(502).json({ error: "图片下载失败" });
    }
    const contentType = imgResp.headers.get("content-type") || "image/png";
    const imgBuf = Buffer.from(await imgResp.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", imgBuf.length);
    res.end(imgBuf);
    console.log(`[图片代理] 已转发 (${(imgBuf.length / 1024).toFixed(0)}KB)`);
  } catch (err) {
    console.error(`[图片代理] 失败:`, err.message);
    res.status(502).json({ error: "图片代理失败" });
  }
});

// ==============================
// 后台生成执行函数
// ==============================
async function runGenerate(taskId, params) {
  const { image, userStyle, strength, style_strength, negative_prompt, width, height, mode, background_enhance, pose_preprocess, enable_faceid, face_image } = params;

  const task = taskStore.get(taskId);
  task.status = "processing";

  // 模式 → LoRA 选择
  const mainLoraKey = (mode === "qclay") ? "qclay"
    : (mode === "carton") ? "carton"
    : "clay";
  const mainLora = LORA_DB[mainLoraKey];
  const enableBgEnhance = background_enhance === true || background_enhance === "true";
  const activeLoras = [mainLora];
  if (enableBgEnhance) activeLoras.push(LORA_DB.food);

  const additionalNetwork = activeLoras.map(l => ({ modelId: l.uuid, weight: l.weights.normal }));
  const triggerWords = activeLoras.map(l => l.trigger).filter(t => t).join(",");
  const fullPrompt = triggerWords
    ? `${CONSTRAINT_TEMPLATE}${triggerWords},${userStyle}`
    : `${CONSTRAINT_TEMPLATE}${userStyle}`;

  await waitForTurn();
  try {
    console.log(`[${taskId}] [1/4] 上传图片到 OSS...`);
    const sourceImageUrl = await uploadImage(image);
    console.log(`[${taskId}]       → ${sourceImageUrl.slice(0, 80)}...`);

    let controlNetSourceUrl = sourceImageUrl;
    const enablePosePreprocess = pose_preprocess === true || pose_preprocess === "true";
    if (enablePosePreprocess) {
      console.log(`[${taskId}] [1.b] 姿态预处理...`);
      try {
        const poseBase64 = await preprocessImage(image);
        controlNetSourceUrl = await uploadImage(poseBase64);
        console.log(`[${taskId}]       → 骨架图上传完成`);
      } catch (ppErr) {
        console.warn(`[${taskId}]       → 姿态预处理失败: ${ppErr.message}`);
      }
    }

    console.log(`[${taskId}] [2/4] 提交图生图任务...`);

    const isPortrait = /证件照|肖像|portrait|headshot|单人/.test(userStyle);
    const isMultiPerson = /多人|跑步|家庭|walking|running|family|group|two|three|four|people|每个人都|四人/.test(userStyle);
    const baseStrength = strength ?? (isPortrait ? 0.47 : isMultiPerson ? 0.43 : 0.47);
    const effectiveStrength = style_strength ?? baseStrength;
    const loraTier = effectiveStrength >= 0.46 ? "portrait" : effectiveStrength <= 0.40 ? "strong" : "normal";

    const tieredLoras = activeLoras.map(l => ({ modelId: l.uuid, weight: l.weights[loraTier] }));
    if (style_strength != null && style_strength !== undefined && tieredLoras.length > 0) {
      tieredLoras[0].weight = Math.min(tieredLoras[0].weight + 0.05, 1.0);
    }

    const generateParams = {
      prompt: fullPrompt,
      negativePrompt: negative_prompt ||
        "face tampered, identity lost, facial features changed or replaced, " +
        "body proportion distortion, limb length wrong, " +
        "fingers stuck together or fused, deformed hands, missing fingers, extra fingers, " +
        "扭曲手指, 手指粘连, 多根手指, 缺失手指, 扭曲手掌, 畸形手部, 模糊指尖, 手部重叠, " +
        "手部结构扭曲, 手掌畸形, 手指弯曲异常, 手指交叉融合, 手部轮廓缺失, 手指关节错位, 手指粗细不均, " +
        "腿部扭曲, 小腿畸形, 脚掌变形, 鞋子融化, 腿脚融合, 脚部结构错乱, 脚趾粘连缺失, 下肢截断, " +
        "legs twisted, feet deformed, shoes melted or fused, foot structure混乱, missing toes, " +
        "extra buttons, added clothing decorations,凭空新增纽扣, " +
        "large scale background reconstruction, original background objects deleted, " +
        "真实皮肤, real human skin texture remaining, realistic skin pores, " +
        "原生发丝, realistic hair strands, normal fabric texture, cloth weave remaining, " +
        "针织布料质感, 写实照片高光, knit texture, fabric weave, " +
        "real skin, human hair, fabric luster, wet sheen, oil shine, metallic gloss, " +
        "perspective distortion, multi-person position shifted, " +
        "animal appearance changed, animal features altered, " +
        "photorealistic, realistic texture, real photo, " +
        "deformed face, bad anatomy, distorted eyes, ugly, extra limbs, " +
        "cloned face, extra people, missing arms or legs, " +
        "glossy plastic, smooth plastic, glossy surface, wax figure, " +
        "outline ghosting, transparent contour residue, edge lines, " +
        "object shape altered, flat background, flat hand-drawn background, paper texture, " +
        "clothing color or pattern changed, " +
        "gender changed, age changed, face replaced, identity swapped, " +
        "added backpack, shoulder straps, extra accessories, " +
        "facial expression wrong, emotion mismatch, " +
        "wrong hairstyle, clothing style changed, " +
        "noise, blurry, oversaturated, low quality",
      clipSkip: 2, sampler: 15, steps: 30, cfgScale: 7,
      randnSource: 0, seed: -1, imgCount: 1, restoreFaces: 1,
      sourceImage: sourceImageUrl,
      resizeMode: 0, resizedWidth: width || 768, resizedHeight: height || 1024,
      mode: 0, denoisingStrength: effectiveStrength,
      additionalNetwork: tieredLoras,
    };

    // ControlNet
    const controlNetUnits = [];
    if (CONTROLNET_MODEL_UUID) {
      controlNetUnits.push({
        unitOrder: 1, sourceImage: controlNetSourceUrl,
        width: 1024, height: 1024, preprocessor: 1,
        annotationParameters: { canny: { preprocessorResolution: 1024, lowThreshold: 200, highThreshold: 300 } },
        model: CONTROLNET_MODEL_UUID, controlWeight: 0.7,
        startingControlStep: 0, endingControlStep: 0.75,
        pixelPerfect: 1, controlMode: 1, resizeMode: 1, maskImage: "",
      });
    }
    if (OPENPOSE_MODEL_UUID) {
      controlNetUnits.push({
        unitOrder: 2, sourceImage: sourceImageUrl,
        width: 1024, height: 1024, preprocessor: 2,
        annotationParameters: { openpose: { preprocessorResolution: 1024 } },
        model: OPENPOSE_MODEL_UUID, controlWeight: 0.55,
        startingControlStep: 0, endingControlStep: 0.75,
        pixelPerfect: 1, controlMode: 1, resizeMode: 1, maskImage: "",
      });
    }
    if (controlNetUnits.length > 0) generateParams.controlNet = controlNetUnits;

    // === IP-Adapter FaceID（人脸锁定，与 ControlNet 并行） ===
    const enableFaceid = params.enable_faceid === true || params.enable_faceid === "true";
    if (IPADAPTER_MODEL_UUID && enableFaceid) {
      // 单人/多人自适应权重：单人 0.58 锁定五官，多人 0.48 避免畸形
      const faceidWeight = isMultiPerson ? 0.48 : 0.58;
      // IP-Adapter 作为独立节点追加，用原图作为人脸参考
      generateParams.controlNet = generateParams.controlNet || [];
      generateParams.controlNet.push({
        unitOrder: controlNetUnits.length + 1,
        sourceImage: sourceImageUrl,  // 原图作为 FaceID 人脸参考
        preprocessor: 0,              // IP-Adapter 不需要预处理
        model: IPADAPTER_MODEL_UUID,
        controlWeight: faceidWeight,
        startingControlStep: 0,
        endingControlStep: 0.85,
        pixelPerfect: 1,
        controlMode: 0,              // 均衡模式
        resizeMode: 1,
        maskImage: "",
      });
      console.log(`[${taskId}]       → FaceID 人脸锁定已启用（权重 ${faceidWeight}）`);
    }

    // === 人脸参考图（可选，无模型依赖，用 Canny 提取参考图五官轮廓） ===
    const hasFaceRef = face_image && face_image.length > 100;
    if (hasFaceRef) {
      console.log(`[${taskId}] [1.c] 上传人脸参考图...`);
      try {
        const faceRefUrl = await uploadImage(face_image);
        generateParams.controlNet = generateParams.controlNet || [];
        generateParams.controlNet.push({
          unitOrder: (controlNetUnits.length + (IPADAPTER_MODEL_UUID && enableFaceid ? 1 : 0)) + 1,
          sourceImage: faceRefUrl,
          width: 1024, height: 1024, preprocessor: 1,
          annotationParameters: { canny: { preprocessorResolution: 1024, lowThreshold: 100, highThreshold: 200 } },
          model: CONTROLNET_MODEL_UUID,
          controlWeight: 0.3,  // 低权重，温和引导五官轮廓
          startingControlStep: 0,
          endingControlStep: 0.6,
          pixelPerfect: 1,
          controlMode: 1,
          resizeMode: 1,
          maskImage: "",
        });
        console.log(`[${taskId}]       → 人脸参考 Canny 引导已启用（权重 0.3）`);
      } catch (faceErr) {
        console.warn(`[${taskId}]       → 人脸参考上传失败: ${faceErr.message}`);
      }
    }

    console.log(`[${taskId}] [2/4] 提交中...`);
    const result = await client.submitImg2Img({
      templateUuid: IMG2IMG_TEMPLATE_UUID,
      generateParams,
    });
    const generateUuid = result.generateUuid;
    console.log(`[${taskId}]       → UUID: ${generateUuid}`);

    console.log(`[${taskId}] [3/4] 等待生成结果...`);
    const prediction = await client.waitResult(generateUuid);

    if (prediction.generateStatus !== 5) {
      throw new Error(`生成失败 (状态码 ${prediction.generateStatus}): ${prediction.generateMsg || "未知错误"}`);
    }

    const imageUrl = prediction.images?.[0]?.imageUrl;
    if (!imageUrl) throw new Error("LiblibAI 未返回图片");

    console.log(`[${taskId}] [4/4] 生成完成!`);

    task.status = "done";
    task.result = {
      imageUrl,  // 保留原始 URL 用于代理
      meta: { generateUuid, pointsCost: prediction.pointsCost, accountBalance: prediction.accountBalance },
    };

    // 保存到 Gallery
    try {
      addGalleryRecord({
        id: taskId,
        taskId,
        prompt: params.userStyle?.slice(0, 80) || "",
        mode: params.mode || "clay",
        strength: params.strength || 0.47,
        hasFaceRef: !!(params.face_image && params.face_image.length > 100),
        pointsCost: prediction.pointsCost,
        createdAt: Date.now(),
      });
    } catch (gErr) {
      console.warn(`[${taskId}] Gallery 保存失败: ${gErr.message}`);
    }
  } catch (err) {
    const apiResp = err.response;
    const apiMsg = (typeof apiResp === 'object' && apiResp !== null) ? apiResp.msg : (typeof apiResp === 'string' ? apiResp : '');
    console.error(`[${taskId}] 异常:`, err.message);
    task.status = "error";
    task.error = apiMsg || err.message;
  } finally {
    releaseTurn();
  }
}

// ==============================
// 配置查看接口
// ==============================
app.get("/api/config", (req, res) => {
  res.json({
    controlnet: CONTROLNET_MODEL_UUID ? "已启用 (Canny)" : "未启用",
    openpose: OPENPOSE_MODEL_UUID ? `已启用 (${OPENPOSE_MODEL_UUID.slice(0,8)}...)` : "未启用",
    ipAdapter: IPADAPTER_ENABLED ? `已启用 (FaceID Plus V2, ${IPADAPTER_MODEL_UUID.slice(0,8)}...)` : "未启用",
    loraModes: {
      default: LORA_DB.clay.desc,
      qclay: LORA_DB.qclay.desc,
      carton: LORA_DB.carton.desc,
      backgroundEnhance: LORA_DB.food.desc,
    },
    template: IMG2IMG_TEMPLATE_UUID,
    defaultDenoising: 0.47,
  });
});

// ==============================
// Gallery 展示接口
// ==============================
app.get("/api/gallery", (req, res) => {
  const records = loadGallery();
  const latest = records.slice(0, 10).map(r => ({
    ...r,
    imageUrl: `/api/image/${r.taskId}`,
  }));
  res.json(latest);
});

// ==============================
// 模型预热（在后台加载，不阻塞服务启动）
// ==============================
async function warmUpModels() {
  console.log("[预热] 加载 TensorFlow.js 姿态检测模型...");
  try {
    // 用一张最小有效图片触发模型初始化
    const { createCanvas } = require("canvas");
    const c = createCanvas(64, 64);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 64, 64);
    const buf = c.toBuffer("image/png");
    const dummyB64 = "data:image/png;base64," + buf.toString("base64");
    await preprocessImage(dummyB64);
    console.log("[预热] 姿态检测模型就绪");
  } catch (err) {
    console.warn("[预热] 模型加载失败（不影响服务，首次请求会延迟）:", err.message);
  }
}

// ==============================
// 启动（HTTP + HTTPS 双端口）
// ==============================
const PORT = process.env.PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 3002;

// HTTP
app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP  → http://0.0.0.0:${PORT}`);
  console.log(`生成接口 → POST http://localhost:${PORT}/api/generate`);
  console.log(`  http://10.0.0.1:${PORT}/`);
  console.log(`  http://127.0.0.1:${PORT}/`);
  warmUpModels();
});

// HTTPS（自签名证书，用于 CCOnline HTTPS 代理转发）
const certPath = path.join(__dirname, "server.cert");
const keyPath = path.join(__dirname, "server.key");
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  https.createServer(
    { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
    app
  ).listen(HTTPS_PORT, () => {
    console.log(`HTTPS → https://0.0.0.0:${HTTPS_PORT}`);
    console.log(`  https://10.0.0.1:${HTTPS_PORT}/`);
    console.log(`  https://127.0.0.1:${HTTPS_PORT}/`);
  });
} else {
  console.log("未找到证书文件，HTTPS 未启动");
}
