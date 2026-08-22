# Desktop 插件市场

[English](marketplace.md) | 中文

DSH Desktop **不会**预装 `dshmarket`。`desktop-marketplace` 这一行 Cordis 插件从内置目录（或可选的 HTTPS JSON URL）发现插件，并走受支持的 Host contract 安装：

```ts
ctx.desktopPnpm.runPlugin(['add', spec], ctx.desktopProfiles.current.dir)
```

这样上游 `dsh plugin` 仍然拥有 profile 初始化、`file:` / `link:` spec，以及 `dsh.profile.bundles` reconcile 的权威语义。

## Settings

```yaml
dsh-desktop-marketplace:
  catalogUrl: ''          # 可选 https://.../catalog.json
  installSpec: 'dsh-web-ui'
```

托盘 **Marketplace** 会列出内置插件，并提供 **Install spec from settings**。自定义 spec 必须是非空的 pnpm 包名。`dshmarket` 会被拒绝。

目录文档可以是 `{ id, name, spec, description, homepage }` 对象数组，或 `{ "plugins": [ ... ] }`。
