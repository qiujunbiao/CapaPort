# CapaPort Logo 与品牌资产系统设计

日期：2026-08-08

状态：已确认

## 1. 目标与边界

为 CapaPort 建立一套可直接用于桌面客户端、Web 管理后台、安装包、系统图标和项目文档的统一 Logo 系统。此次只调整视觉品牌资产及其展示组件，不改变产品名称、产品功能、业务流程或信息架构。

品牌含义延续既有定义：CapaPort 是跨 Agent 的企业 AI 能力治理与分发平台。图形需要同时表达 Capability、Port、汇聚与分发，不再使用通用的 `DoorOpen` 图标或靠 CSS 拼装的临时图形。

## 2. 设计方向

采用已确认的 **Portal Flow** 方向，中文工作名为“能力端口”。它由两部分构成：

- **端口轮廓**：一个向右开放的几何 `P`/端口结构，兼具 CapaPort 首字母与软件端口的联想。
- **能力流**：三条独立轨迹从左侧汇入端口，经治理后成为一条向右输出的路径，表达 Skill、Prompt、项目上下文包被统一沉淀、审核与分发。

图形采用平面几何，不使用拟物高光、照片纹理、细小节点或复杂渐变。完整标志在 16px favicon、32px 系统图标和大尺寸安装界面中都必须保留清晰轮廓。

## 3. 视觉规范

### 3.1 主色

- Graphite 950：`#15171D`，主背景和深色应用图标底。
- Paper 50：`#F7F4ED`，端口轮廓和深色背景上的字标。
- Flow Orange 500：`#FF6426`，能力流与主要识别色。
- Flow Orange 400：`#FF8A32`，仅用于大尺寸数字界面中的轻微流向过渡。
- Ink 900：`#181A20`，浅色背景上的正文和单色标。

主标默认使用 Graphite、Paper 与 Flow Orange 三色。小于 32px、打印、系统模板或高对比场景使用纯黑/纯白单色版本，避免小尺寸渐变产生模糊边缘。

### 3.2 字标

产品字标统一显示 `CAPAPORT`，使用项目现有的 `DM Mono` 字体栈，字重 600，字距 `0.12em`。正式锁定组合只包含产品名，不把 `CAPABILITY REGISTRY` 或 `CONTROL PLANE` 固化进 Logo；这些词可作为界面上下文标签独立排版。

图形与字标的标准间距为图形宽度的 0.28 倍。安全留白为图形内部能力流笔画宽度的 2 倍。不得拉伸、旋转、改变流向、替换橙色或给标志添加投影。

### 3.3 应用图标

应用图标使用深色圆角方形底板，中央放大“端口 + 能力流”图形。图形四周保留约 16% 安全区，避免 macOS 自动遮罩、Windows 小图标和任务栏缩放裁切主体。

- macOS：源图保留方形画布和系统建议的视觉安全区，由 Tauri 生成 `.icns`。
- Windows：生成包含 16、24、32、48、64、128、256px 层级的 `.ico`，并生成 NSIS/应用列表需要的 PNG 资产。
- Linux：生成 32、128、256、512px PNG，供桌面文件和 AppImage 使用。
- Web：使用同一标志生成 `favicon.svg`、`favicon.ico`、`apple-touch-icon.png` 和 Web manifest 图标。

所有平台图标来自同一个 1024×1024 SVG 母版，禁止各平台单独手绘导致形状漂移。

## 4. 资产结构与组件边界

品牌源文件集中到仓库根目录 `brand/`：

- `brand/capaport-mark.svg`：透明背景彩色图形母版。
- `brand/capaport-mark-mono.svg`：透明背景单色图形。
- `brand/capaport-lockup-dark.svg`：深色背景横向组合。
- `brand/capaport-lockup-light.svg`：浅色背景横向组合。
- `brand/capaport-app-icon.svg`：1024×1024 应用图标母版。
- `brand/README.md`：色值、留白、最小尺寸和生成命令。

应用内不复制 SVG 路径。Desktop 与 Web 各自提供轻量 `BrandMark`/`BrandLockup` React 组件，统一引用品牌资产并负责尺寸、上下文副标题与无障碍文本。现有 `DoorMark`、CSS 拼装图形和 Lucide `DoorOpen` 品牌占位全部移除。

生成型图标保存在平台要求的位置：

- `apps/desktop/src-tauri/icons/`：Tauri 生成的 macOS、Windows、Linux 全套图标。
- `apps/desktop/public/`：桌面 WebView favicon 和可直接加载的品牌资源。
- `apps/web/public/`：Web favicon、触屏图标、manifest 图标及共享 SVG。

## 5. 替换范围

### 5.1 Desktop

- 登录、注册、组织加入页的完整品牌组合。
- 主侧边栏展开态的完整组合和折叠态的图形标。
- `apps/desktop/index.html` 的 favicon、主题色和应用标题。
- Tauri `bundle.icon` 显式声明的完整平台图标列表。
- macOS `.app`/Dock/DMG、Windows `.exe`/NSIS/开始菜单、Linux 包图标。

### 5.2 Web 管理后台

- 登录页、组织初始化页、管理后台侧边栏中的通用图标占位。
- `apps/web/index.html` 的 favicon、Apple Touch Icon、manifest 与主题色。
- 移动导航和窄屏场景下的紧凑标志。

### 5.3 文档与仓库展示

- README 顶部使用横向组合标，保留文本标题作为可访问降级。
- 品牌规范文档记录生成方式，避免后续直接替换某个输出尺寸。
- 不修改历史设计文档中的产品含义，也不把视觉副标题写入协议、包名或 CLI 命令。

## 6. 生成与构建方案

Logo 采用确定性的 SVG 源码制作，不使用 AI 生成位图作为正式母版。这样可以保证几何一致、背景透明、小尺寸锐利，并能审查每个路径。

桌面图标使用项目已安装的 Tauri CLI 从 `brand/capaport-app-icon.svg` 生成。生成结果纳入版本控制，并在 `tauri.conf.json` 中显式列出，确保本地构建和 CI 发布使用同一套资产。Web 栅格尺寸从相同 SVG 母版生成，避免二次设计。

## 7. 可访问性与降级

- 纯装饰标志使用 `aria-hidden="true"`；承担品牌识别的锁定组合使用 `role="img"` 和 `aria-label="CapaPort"`。
- 图形不作为按钮的唯一可见说明。
- 深色与浅色组合的关键形状对比度至少达到 3:1。
- `prefers-contrast: more` 下使用单色高对比版本。
- SVG、PNG 或 Web manifest 加载失败时，界面仍显示 `CAPAPORT` 文本字标。

## 8. 验证标准

实施完成必须同时满足：

1. 全仓运行时代码中不再使用 `DoorMark`、`.door-mark` 或 Lucide `DoorOpen` 充当品牌 Logo。
2. Desktop 和 Web 的品牌组件测试覆盖完整、紧凑、深色、浅色和无障碍属性。
3. favicon、Apple Touch Icon、manifest 图标以及 Tauri 平台图标全部存在，尺寸与 alpha 通道正确。
4. `pnpm --filter @capaport/web build` 与 `pnpm --filter @capaport/desktop build` 通过。
5. Rust/Tauri 配置校验、桌面单元测试和现有桌面 E2E 通过。
6. 在 macOS 实际执行 release bundle，检查 `.app`、Dock 图标和 DMG 中的应用图标；Windows 图标由生成文件结构与 CI 配置测试覆盖。
7. 16、32、128、512 和 1024px 抽样渲染无裁切、透明边缘污染、细节消失或不可辨识问题。
8. 最终 release 验证通过，品牌替换不改变任何业务功能。

## 9. 非目标

- 不重新命名 CapaPort 或修改产品口号。
- 不改造现有主题系统、导航结构或业务页面布局。
- 不加入动态 Logo、启动动画或音效。
- 不在本次工作中申请商标、域名或第三方品牌认证。
