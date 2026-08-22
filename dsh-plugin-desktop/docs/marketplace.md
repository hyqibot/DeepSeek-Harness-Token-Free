# Desktop marketplace

English | [中文](marketplace.zh.md)

DSH Desktop does **not** preinstall `dshmarket`. The `desktop-marketplace` Cordis row discovers plugins from a bundled catalog (or an optional HTTPS JSON URL) and installs them with the supported Host contract:

```ts
ctx.desktopPnpm.runPlugin(['add', spec], ctx.desktopProfiles.current.dir)
```

That keeps upstream `dsh plugin` authoritative for profile initialization, `file:` / `link:` specs, and `dsh.profile.bundles` reconciliation.

## Settings

```yaml
dsh-desktop-marketplace:
  catalogUrl: ''          # optional https://.../catalog.json
  installSpec: 'dsh-web-ui'
```

The tray **Marketplace** command lists bundled plugins and **Install spec from settings**. Custom specs must be non-empty pnpm package names. `dshmarket` is rejected.

A catalog document is either an array of `{ id, name, spec, description, homepage }` objects or `{ "plugins": [ ... ] }`.
