# Agent Note: Desktop HYQi remote model

Status: implemented

English | [中文](2026-08-18-desktop-hyqi-remote-model.zh.md)

## Problem

DSH Desktop needed a built-in **HYQi** chat model that reuses the existing `https://license.hyqibot.com` activation session. That activation already gates CoPaw Zero-Token; HYQi should use the same session, bound to the same device fingerprint.

## Decision

Plan C only: the desktop Host injects `llm-pi-ai.providers.hyqi` (`api: openai-completions`, `baseURL: https://license.hyqibot.com/hyqi/v1`). The Bearer token is the activation `sessionToken`; `X-Device-Id` is the activate fingerprint. license-server persists sessions and enforces quotas (editable on the ops machine via `.env` / `hyqi-quota.json`). EdgeOne Pages adds `/hyqi/v1/*` so clients never hit ECS:3460 directly.

Do not edit `deepseek-harness/` or `vendor/copaw-zero-token`.

## Verification

- `license-server`: `bun test` (`hyqiQuota`, `hyqiGuard`, `hyqiProxy`)
- `dsh-plugin-desktop/tests/channel-hyqi.spec.ts`, `package.spec.ts`, `profile.spec.ts`
- `scripts/packaging/user-distribution-policy.json` forbids operator credential strings in user packages
