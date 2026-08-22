# 复制即用：Discussions 首帖 + 社群帖结尾

发到公开仓即可，不必改仓库文件。

## 1. 先打开 Discussions

公开仓 → **Settings** → **General** → 滚到 Features → 勾选 **Discussions**。

建议分类：

- **Q&A**（问答）→ 用法
- **Ideas**（想法）→ 功能建议
- **Announcements**（公告）→ 发版、下载说明
- 安装失败 / Bug 不要放 Discussions，走 Issues 模板

仓库里已有 `.github/DISCUSSION_TEMPLATE/`，打开 Discussions 后，到 **Settings → Discussions** 把 Q&A、Ideas 分类绑到对应表单。

## 2. 首帖（Announcements，可 Pin）

**标题：** 欢迎 / 如何下载桌面版

**正文：**

```markdown
欢迎使用 DeepSeek-Harness-Token-Free 桌面端。

## 下载

请只从本仓 Releases 安装，不要用网盘或源码 `yarn dev` 当免 Token 客户端（公开源码没有完整免 Token 网关）。

- Windows x64：Releases 里的 `DSH-Desktop-*-x64-Setup.exe`
- macOS Apple Silicon（M 系列）：`DSH-Desktop-*-arm64.dmg`
- macOS Intel：`DSH-Desktop-*-x64.dmg`

最新版本：https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases/latest

## macOS 打不开

当前 Mac 包未公证。请在 Finder 里 **右键 → 打开**，不要双击。

## 去哪提问

- 安装失败、打不开、崩溃 → [Issues](https://github.com/hyqibot/DeepSeek-Harness-Token-Free/issues/new/choose)
- 用法、配模型、想法 → Discussions

觉得有用请 Star 本仓，让更多人看到：https://github.com/hyqibot/DeepSeek-Harness-Token-Free
```

## 3. 每条社群帖固定结尾（微信 / 小红书 / 即刻 / Discord）

GitHub 不会自动往你的社群帖加 Star。做法是：把下面这段存成「常用语」，每条帖子最后粘上。

**中文：**

```text
⭐ 觉得好用请 Star 一下，让更多人看到：
https://github.com/hyqibot/DeepSeek-Harness-Token-Free

⬇️ 下载桌面版（Windows / Mac）：
https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases/latest
```

**英文：**

```text
⭐ If this helps, please Star the repo:
https://github.com/hyqibot/DeepSeek-Harness-Token-Free

⬇️ Download (Windows / macOS):
https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases/latest
```
