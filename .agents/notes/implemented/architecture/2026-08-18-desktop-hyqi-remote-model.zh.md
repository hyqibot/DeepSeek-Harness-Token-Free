# Agent Note: 桌面 HYQi 远程模型

Status: implemented

[English](2026-08-18-desktop-hyqi-remote-model.md) | 中文

## Problem

DSH Desktop 需要内置 **HYQi** 聊天模型，复用现有 `https://license.hyqibot.com` 激活会话。该激活码已经给 CoPaw Zero-Token 开门；HYQi 应复用同一会话，并绑定同一设备指纹。

## Decision

只做方案 C：Host 注入 `llm-pi-ai.providers.hyqi`（`api: openai-completions`，`baseURL: https://license.hyqibot.com/hyqi/v1`）。Bearer 是激活 `sessionToken`；`X-Device-Id` 与激活时相同。license-server 落盘会话，并按运行机 `.env` / `hyqi-quota.json` 执行额度。EdgeOne Pages 增加 `/hyqi/v1/*`，客户端不直连 ECS:3460。

不改 `deepseek-harness/` 与 `vendor/copaw-zero-token`。

## Verification

- `license-server`：`bun test`
- `dsh-plugin-desktop/tests/channel-hyqi.spec.ts`、`package.spec.ts`、`profile.spec.ts`
- 分发策略禁止运维凭据字符串进入用户包
