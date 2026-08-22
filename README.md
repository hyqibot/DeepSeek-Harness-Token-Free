<p align="center">
  <a href="https://github.com/hyqibot/DeepSeek-Harness-Token-Free"><img src="https://img.shields.io/github/stars/hyqibot/DeepSeek-Harness-Token-Free?style=flat&amp;label=%E2%98%85&amp;color=08C" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/Desktop-App-47848F?style=flat" alt="Desktop application">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <a href="https://discord.gg/TJeGqKRNM"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&amp;logo=discord&amp;logoColor=white" alt="Join Discord"></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows-4493F8?style=flat-square" alt="Supported platforms: macOS and Windows">
</p>

<p align="center"><sub>中文 · <a href="README.en.md">English</a></sub></p>

<h3 align="center">为 DeepSeek Harness (DSH) 生态打造的全免 Token 费桌面端</h3>

<a id="run"></a>

<!-- bump these 3 URLs on each desktop release (filenames include the version) -->
<p align="center">
  <a href="https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases/download/v2.2.5/DSH-Desktop-2.2.5-x64-Setup.exe"><img src="https://img.shields.io/badge/Windows-x64-0078D4?style=for-the-badge&amp;logo=windows&amp;logoColor=white" alt="下载 Windows x64"></a>
  &nbsp;
  <a href="https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases/download/v2.2.5/DSH-Desktop-2.2.5-arm64.dmg"><img src="https://img.shields.io/badge/macOS-Apple_Silicon-000000?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="下载 macOS Apple Silicon"></a>
  &nbsp;
  <a href="https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases/download/v2.2.5/DSH-Desktop-2.2.5-x64.dmg"><img src="https://img.shields.io/badge/macOS-Intel-6E6E6E?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="下载 macOS Intel"></a>
</p>
<p align="center"><sub>当前 v2.2.5 · <a href="https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases/latest">全部版本</a> · Mac 未公证，请右键「打开」</sub></p>

<p align="center">
  <img src="assets/desktop-demo.gif" alt="DeepSeek Harness 桌面端演示" width="100%">
</p>

> **公开仓说明**：桌面安装包与更新见 [Releases](https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases)。**要使用免 Token（Zero-Token）功能，必须安装 Releases 里的桌面版**（内含预编译网关）；公开源码无法自行构建完整 Zero-Token 网关。

## 主要功能

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Desktop</h3>
      <p>把官方 DeepSeek Harness 的本地 Web UI 带到原生桌面。应用自动启动和管理本地 Harness 服务，集成系统托盘与桌面窗口，无需安装 Node.js 或执行命令。</p>
    </td>
    <td width="50%" valign="top">
      <h3>手机远程控制</h3>
      <p>Telegram、Discord、飞书、微信与局域网 PWA 共用一套配对码。用手机 Bot 或把 PWA 添加到主屏幕，即可向本机 Agent 发任务。Web UI 仍锁在 127.0.0.1。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>插件市场</h3>
      <p>托盘 Marketplace 按官方 <code>dsh plugin add</code> 安装目录插件，不预装未审计的 dshmarket。服务管理、系统集成与市场都是 Cordis Host 行，可随 profile 组合。</p>
    </td>
    <td width="50%" valign="top">
      <h3>Channels</h3>
      <p>IM 通道在 Host 进程内配对后即可遥控 Agent。免token 网关也在同一进程监听 localhost：官方 API key 免激活码；可选的免token 可免 Token 费使用网页模型。激活码同时开通聊天模型 <strong>HYQi</strong>（社区额度，无需另填 Key）。</p>
    </td>
  </tr>
</table>

## 插件生态

DeepSeek Harness 基于 [Cordis](https://github.com/cordiverse/cordis) 构建，并采用“一切皆插件”的架构。模型适配器、工具注册表、会话日志和 Agent Loop 等核心能力都以插件参与运行，可以通过配置自由组合或替换；外部插件也可以通过 profile 与 bundle 接入现有运行时。详见官方的[架构说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)和[插件管理文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md#plugin-management)。

Desktop 已经按官方 Cordis 插件机制组织：窗口与托盘（`desktop-shell`）、服务与 pnpm（`desktop-pnpm` / `desktop-profiles`）、系统集成（`desktop-terminal` / `desktop-updates`）、IM 遥控（`desktop-channels`）、局域网手机壳（`desktop-mobile`）、免token 网关（`desktop-zero-token`）、HYQi 社区模型（`desktop-hyqi`）、插件市场（`desktop-marketplace`）和插件开关（`desktop-plugin-toggles`）都作为 Host 行挂进 profile，可用 `dsh plugin add` 同样的组合方式接入。


## 声明

本项目基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 构建。

本项目基于 DeepSeek Harness 和 Cordis 插件思想的实现，旨在为大家构建快速上手的 DeepSeek Harness 桌面体验， 同时提供可选的免token费接入各大模型， 降低ai应用的使用门槛。


<a id="run-from-source"></a>

## 社区交流

可选择常用的平台参与讨论，交流使用问题、插件开发和项目进展。

<table>
  <thead>
    <tr>
      <th align="center">微信群</th>
      <th align="center">钉钉群</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wechat-group.png" alt="DeepSeek-Harness-Token-Free 微信群二维码" width="180" height="180"></td>
      <td align="center"><img src="assets/community-qq-group.jpg" alt="DeepSeek-Harness-Token-Free 钉钉群二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 从源码运行

公开仓可用于本地体验 **桌面端**（`yarn dev`）与 **官方 / API Key 模型**。

> **限制**：本仓库不含 Zero-Token 网关完整源码与预编译 sidecar，**无法**通过源码本地使用网页免 Token；请安装 [Releases](https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases) 桌面版。

**环境要求**

- Node.js 22.19+ 或 24+（含 Corepack）
- [Git](https://git-scm.com/download/win)（Windows 必装）

**1. 克隆与安装**

```bash
git clone --recurse-submodules https://github.com/hyqibot/DeepSeek-Harness-Token-Free.git
cd DeepSeek-Harness-Token-Free
corepack enable
yarn install
```

**2. 启动桌面端**

```bash
yarn dev
```

在设置中配置官方 API Key 后即可聊天。网页 Zero-Token（无官方 Key）**仅 Releases 安装包可用**。

**说明**

- 公开仓 **不含** `dsh-plugin-desktop/vendor/copaw-zero-token/python/`，本地 `yarn dist:win` / `yarn dist:mac` **不能**产出含完整 Zero-Token 网关的安装包。

## License

本项目遵循 [MIT License](LICENSE)。

DeepSeek 网页 PoW 求解器移植自 [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token)（Copyright (c) 2025 Peter Steinberger），按 MIT 授权。完整版权声明与许可全文见 [`dsh-plugin-desktop/vendor/copaw-zero-token/LICENSE-openclaw-zero-token.txt`](dsh-plugin-desktop/vendor/copaw-zero-token/LICENSE-openclaw-zero-token.txt)。该第三方 MIT 声明独立于上文 DeepSeek 版权。免token 设置页亦可查看。

> 本项目是基于 DeepSeek Harness 构建的社区桌面版本，并非 DeepSeek 官方产品。

