# Zero-Token 网关（公开源码说明）

本公开仓库 **不包含** Zero-Token 网关完整实现（`python/`、`webauth-ts/` 等）及预编译 sidecar。第三方 MIT 许可全文见 [`LICENSE-openclaw-zero-token.txt`](LICENSE-openclaw-zero-token.txt)。

- **桌面安装包**：请从 [Releases](https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases) 下载；安装包内已含发行方私有构建的网关。
- **Zero-Token 功能**：需在设置中完成激活；授权服务由发行方单独部署，不在本仓库。官方 API Key 路径不需要激活码。
- **本地开发**：可正常使用 `yarn dev` 启动桌面端，以及官方 / API Key 类模型；**无法**在公开 clone 上本地执行完整网页 Zero-Token（Playwright / PoW）网关。

维护者从私有源码仓单向同步至本目录；请勿向私有仓 merge 公开仓变更。
