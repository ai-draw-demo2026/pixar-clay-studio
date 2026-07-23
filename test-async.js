// 测试异步架构全流程
const BASE = "http://127.0.0.1:3001";

async function main() {
  // 1. 提交（使用最小有效图片触发真实流程）
  console.log("[提交] 发送请求...");
  const submitResp = await fetch(BASE + "/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "test portrait",
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      strength: "normal",
      mode: "clay",
      pose_preprocess: false,
    }),
  });
  const submitJson = await submitResp.json();
  console.log("[提交] 结果:", JSON.stringify(submitJson));

  if (!submitJson.taskId) {
    console.log("[失败] 没有 taskId");
    return;
  }

  const taskId = submitJson.taskId;

  // 2. 轮询结果
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const resultResp = await fetch(BASE + "/api/result/" + taskId);
    const resultJson = await resultResp.json();
    console.log(`[轮询 ${i * 2}s] status=${resultJson.status}`);

    if (resultJson.status === "done") {
      console.log("[成功] 图片:", resultJson.image?.slice(0, 100));
      return;
    }
    if (resultJson.status === "error") {
      console.log("[失败] 错误:", resultJson.error);
      return;
    }
  }
  console.log("[超时] 120 次轮询未完成");
}

main().catch(console.error);
