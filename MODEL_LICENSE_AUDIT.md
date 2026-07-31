# 模型商用授权核查清单（Pixar Clay Studio）

> 目标：商用上线前，**每一个**在用的模型都必须确认"允许商用"。
> 用法：对每个模型打开出处页，把"授权栏 + 描述文字"都看一遍，对照下面的危险词/允许词，打勾。

---

## 一、去哪看授权（按出处）

| 出处 | 在哪看 |
|------|--------|
| 哩布哩布 LiblibAI | 模型页往下拉，找「许可协议 / 授权 / 使用条款」栏，看作者在描述里有没有额外声明 |
| CivitAI | 模型页右下角 License 下拉框 + 作者写的 Description 里的自定义条款 |
| HuggingFace | 仓库页右侧 License 字段 + 顶部 model card 文字 |

**最大的坑**：授权栏写着允许（比如 OpenRAIL-M），但作者在描述文字里又加了"仅供学习交流，禁止商用"——**以作者实际声明为准，两处都要看。**

---

## 二、判断关键词

### 🚫 出现这些 = 不能商用
- 不得商用 / 禁止商用 / 不可商用 / 禁止用于商业用途
- 仅供学习交流 / 仅供学习参考
- 不得用于托管于计划赚取收入或捐赠的网站/应用程序
- 商用需额外购买 / 商用授权另付费
- Non-commercial / Not for commercial use / personal use only
- CC BY-NC / CC BY-NC-SA / CC BY-NC-ND

### ✅ 出现这些 = 可以商用
- 允许商用 / 可商用 / 自由商用 / 支持商用 / 无使用限制
- CC0 / Public Domain（公有领域，随便用）
- Apache 2.0 / MIT / BSD
- CreativeML OpenRAIL-M（SD 最主流授权，允许商用，但输出有使用限制，见下）
- commercial use allowed / free for commercial use

### ⚠️ OpenRAIL-M 的隐藏限制（允许商用，但输出要守规矩）
绝大多数 SD 底模和 LoRA 用这个授权，商用没问题，但生成内容不能：
- 模仿**具体可识别的真实个人**（不能拿它做真人换脸）
- 生成违法或有害内容
- 用作医疗/法律/政治等误导性信息

---

## 三、全量模型清单（当前代码里所有在用的）

### A 组：LiblibAI 后端（现在网页跑的这套）

| # | 模型 | 作用 | uuid / 出处 | 授权状态 |
|---|------|------|------------|----------|
| 1 | Clay Word 黏土滤镜风格XL | 皮克斯黏土（默认模式） | `9b04646c89c848148df28433af632eda`（哩布） | ⬜ 待查 |
| 2 | Qclay_XL_V2.0 | Q版黏土人偶 | `a95bc41f4d10466bba633dcd0143155f`（哩布） | ❌ **已确认禁止商用**（卡片写明不得用于赚取收入/捐赠的网站） |
| 3 | Fooooding_XL 黏土浮雕画手工 | 背景增强 | `85a7362bf1144b9a9ca0675f1e4d057e`（哩布） | ⬜ 待查 |
| 4 | SDXL卡通3D形象盲盒手办 | 手办（硬质PVC） | `5ea847aa8e834f8ca9f76006a0309858`（哩布） | ⬜ 待查 |
| 5 | PVC盲盒手办 | 手办（二次元） | `723c7db093e04cb7837ea921a0129d71`（哩布） | ⬜ 待查 |
| 6 | 图生图模板 | 生图模板 | `9c7d531dc75f476aa833b3d452b8f7ad`（哩布） | ⬜ 待查 |
| 7 | Canny ControlNet | 锁定轮廓 | `.env` 的 CONTROLNET_MODEL_UUID（哩布） | ⬜ 待查 |
| 8 | OpenPose | 姿态锁定 | `.env` 的 OPENPOSE_MODEL_UUID（哩布） | ⬜ 待查 |
| 9 | IP-Adapter FaceID Plus V2 | 人脸锁定 | `.env` 的 IPADAPTER_MODEL_UUID（哩布） | ⬜ 待查 |

### B 组：SD WebUI 后端（AutoDL 规划中，下次下载时就要注意）

| # | 模型 | 作用 | 出处 | 授权状态 |
|---|------|------|------|----------|
| 10 | 底模 SDXL（PixarSDXL / Modern Disney XL 等） | 风格底色 | 哩布 / CivitAI | ⬜ 待查（认准允许商用的） |
| 11 | Clay_Word_XL.safetensors | 黏土质感 LoRA | 哩布 / CivitAI | ⬜ 待查 |
| 12 | Perfect_Hands_XL_v3.safetensors | 手部修复 LoRA | 哩布 / CivitAI | ⬜ 待查 |
| 13 | hand_yolov8n.pt | ADetailer 手部检测 | HF: `Bingsu/adetailer` | ⬜ 待查（看 HF license 字段） |
| 14 | xinsir-controlnet-canny-sdxl-1.0 | SDXL Canny ControlNet | HF: `xinsir/...` | ⬜ 待查（看 HF license 字段） |

### C 组：平台层（生成服务本身的条款，别漏）

| # | 项 | 说明 |
|---|----|------|
| 15 | 哩布哩布服务条款 | 目前后端跑在哩布服务器上，商用生成还要看平台 ToS，有的模型平台要求商用另付费 |
| 16 | CivitAI/HF 下载时的 License 页面 | 从这下的模型以页面 License + 作者声明为准 |

---

## 四、❌ 的模型怎么办（三条路）

1. **换"允许商用"的同款**：哩布按「可商用」筛选，CivitAI 认准 CC0 / OpenRAIL-M 且描述里没加禁止商用的。
2. **自训练**：AutoDL 租好 GPU 后用 kohya 训练自己的 LoRA（Q版黏土、手部修复都能训），模型和数据全归你，商用无限制。这是终局方案，也是买 GPU 的根本意义。
3. **过渡期**：不上线、不收费、不公开的阶段可以用任意模型测试；**上线收费前**必须全部换成 1 或 2 的。

---

## 五、动作清单（照做）

- [ ] A组 1/3/4/5/6/7/8/9 逐个打开哩布模型页，抄授权，标 ✅/❌
- [ ] #2 Qclay 确认 ❌ → 商用前替换（自训练或换可商用 Q 版黏土 LoRA）
- [ ] B组 10-14 下载前先在页面确认授权，别下完再发现不能用
- [ ] C组 15 读一遍哩布平台服务条款关于商用的部分
- [ ] 以后每新增一个模型，默认先标记"未核查"，核查通过才能进商用产品
