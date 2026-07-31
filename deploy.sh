#!/bin/bash
# Pixar Clay Studio 一键部署脚本（在服务器上执行）

set -e

echo "===== 1. 解压代码 ====="
tar xzf pixar-clay-deploy.tar.gz

echo "===== 2. 创建 .env（仅首次部署时创建） ====="
if [ ! -f .env ]; then
  cat > .env << 'ENVEOF'
# 首次部署：把下面两行密钥换成你自己的，然后重新运行 ./deploy.sh
LIBLIBAI_ACCESS_KEY=你的LiblibAI访问密钥
LIBLIBAI_SECRET_KEY=你的LiblibAI密钥
CONTROLNET_MODEL_UUID=
OPENPOSE_MODEL_UUID=
IPADAPTER_MODEL_UUID=
# 用自建 GPU（SD WebUI）时取消注释：
# AI_BACKEND=sdwebui
# SD_WEBUI_URL=http://你的GPU实例:7860
# SD_WEBUI_LORA_CLAY=Clay_Word_XL.safetensors
# SD_WEBUI_LORA_HAND=Perfect_Hands_XL_v3.safetensors
ENVEOF
  echo "已生成 .env 模板，请先编辑 .env 填入真实密钥后再运行："
  echo "  nano .env && ./deploy.sh"
  exit 1
else
  echo ".env 已存在，跳过创建（保留现有配置）"
fi

echo "===== 3. 安装依赖 ====="
npm install

echo "===== 4. 安装 PM2（如未安装） ====="
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2 || sudo npm install -g pm2
fi

echo "===== 5. 启动/重启服务 ====="
pm2 start server.js --name pixar-clay || pm2 restart pixar-clay
pm2 startup || true
pm2 save

echo ""
echo "✅ 部署完成！"
echo "运行 pm2 status 查看状态"
echo "运行 ./cloudflared tunnel --url http://localhost:3001 创建公网访问"
