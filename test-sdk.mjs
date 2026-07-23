import crypto from 'crypto';

// 直接用 SDK 源码里的逻辑
const API_KEY = "IGHrpNngUIj4o8Jl2Ma7aw";
const API_SECRET = "fFajozPFu461Ut28B4taJEq498_xERPQ";

function sign(path) {
  const ts = Date.now();
  const nonce = Math.random().toString(36).slice(2, 18) + Math.random().toString(36).slice(2, 18);
  const content = `${path}&${ts}&${nonce}`;
  const hash = crypto.createHmac('sha1', API_SECRET).update(content).digest('base64')
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${path}?AccessKey=${API_KEY}&Signature=${hash}&Timestamp=${ts}&SignatureNonce=${nonce}`;
}

const testPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErJggg==";

// 先提交任务
const endpoint = "/api/generate/webui/img2img";
const url = `https://openapi.liblibai.cloud${sign(endpoint)}`;

const body = {
  templateUuid: "6f7c4652458d4802969f8d089cf5b91f",
  generateParams: {
    prompt: "a cute cat, cartoon style",
    negative_prompt: "bad quality, ugly",
    steps: 20,
    width: 512,
    height: 512,
    imgCount: 1,
    seed: -1,
    init_images: [testPng],
    denoising_strength: 0.35
  }
};

const resp = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
const data = await resp.json();
console.log("Response:", JSON.stringify(data, null, 2));

// 如果有 generateUuid，轮询结果
if (data.code === 0 && data.data?.generateUuid) {
  const uuid = data.data.generateUuid;
  console.log("\nPolling for results...");
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = sign("/api/generate/webui/status");
    const statusResp = await fetch(`https://openapi.liblibai.cloud${s}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generateUuid: uuid })
    });
    const status = await statusResp.json();
    const st = status.data?.generateStatus;
    console.log(`  Status: ${st} (${['?','等待','处理中','已生成','审核中','成功','失败','超时'][st] || '?'})`);
    if (st === 5) {
      console.log("  SUCCESS! Images:", JSON.stringify(status.data.images?.slice(0,1)));
      break;
    }
    if (st === 6 || st === 7) {
      console.log("  FAILED:", status.data?.generateMsg || status.msg);
      break;
    }
  }
}
