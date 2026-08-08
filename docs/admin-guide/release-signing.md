# 桌面签名与发布

`.github/workflows/release.yml` 在受保护的 `v*` 标签上构建 macOS、Windows 桌面安装包、CLI 和多架构后端镜像。

## Tauri 更新签名

生成离线保存的 Tauri updater 密钥，把公钥写入 `apps/desktop/src-tauri/tauri.conf.json`，私钥只配置为 GitHub Actions secret：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

仓库中的开发公钥必须在生产首发前替换。桌面设置页通过 Tauri updater 检查清单、校验签名、显示下载进度、安装并在用户确认后重启；签名校验或下载失败时不会进入“已安装”状态。更新服务返回与目标平台、架构和当前版本匹配的已签名清单；不得启用不安全传输。

发布流水线调用 `scripts/create-updater-manifest.ts` 生成 `latest.json`，同时发布签名包和 `.sig`。生产发布服务必须把该清单及对应文件原样同步到 `https://releases.agentdoor.com/desktop/...`，并在切换 `latest` 前验证清单中的版本、平台 URL 和签名文件均存在。私钥只参与 CI 签名，更新服务只持有公开文件。

## macOS

配置 Apple Developer ID 证书和公证账户：

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
```

流水线构建 `universal-apple-darwin` 产物，同时覆盖 Apple Silicon 和 Intel。发布前在干净 macOS 主机验证签名、公证、自动更新和首次启动，不允许用临时 ad-hoc 签名替代正式产物。

## Windows

把受信任的代码签名 PFX 以 base64 和密码写入受保护的 Actions secrets：

```text
WINDOWS_CERTIFICATE
WINDOWS_CERTIFICATE_PASSWORD
```

工作流只在临时 Runner 导入证书，构建 `x86_64-pc-windows-msvc` NSIS 包，通过 SHA-256 和可信时间戳签名，完成后销毁临时 PFX。验证安装包签名链、SmartScreen 元数据、安装/卸载、升级和回滚。签名凭据不得写入仓库或普通构建日志。

## CLI 与镜像

CLI 产物附带 SHA-256。每个桌面产物目录包含 `SHA256SUMS`、`release-metadata.json` 和 SPDX JSON SBOM，GitHub Actions 为全部文件生成构建来源证明。容器发布使用不可变标签，BuildKit 生成 SBOM 和 provenance，并在推送前运行高危/严重漏洞扫描。发布记录应保存 Git SHA、工作流运行号、摘要、SBOM、来源证明和签名验证结果。
