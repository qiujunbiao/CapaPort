# CapaPort 密码策略简化设计

**日期：** 2026-08-11
**状态：** 已确认方案 A，等待书面规格复核
**范围：** 注册、密码重置、Web 与 Desktop 密码提示、Google 泄露凭据检测

## 目标

把当前“至少 12 位且必须同时包含大小写字母、数字和符号”的组合规则，简化为用户容易理解、服务端可以明确执行的策略：

- 密码至少 8 个字符，最多 256 个字符；
- 允许字母、数字、符号、空格和 Unicode 字符，不要求固定字符类别组合；
- 拒绝明显过于简单、容易猜测或包含用户上下文的密码；
- 拒绝 Google Cloud Password Defense 判定已经泄露的账号与密码组合；
- 在输入前展示规则，在失败时展示具体中文原因，不再只显示英文总错误。

本次不增加 MFA、Passkey、SSO、定期强制改密或既有账号密码批量失效逻辑。现有密码继续有效；新策略只作用于注册和密码重置。

## 方案选择

采用服务端强制校验与 Google Cloud reCAPTCHA Enterprise Password Defense 组合方案。

不采用以下方案：

- 仅依赖浏览器 Google Password Manager：浏览器可以提示用户，但 CapaPort 服务端无法强制阻止风险密码；
- 仅使用本地词库：无法满足“不能使用已经泄露或被 Google 判定存在风险的密码”的要求；
- 继续使用字符类别组合规则：用户体验复杂，而且不能有效识别 `Password1!` 之类符合形式但容易猜测的密码。

## 服务端密码策略

### 本地同步校验

新增单一的密码策略入口，注册和密码重置必须调用同一实现。校验顺序固定为：

1. 原始密码长度必须在 8 到 256 个 Unicode code point 之间；不使用 JavaScript UTF-16 `length` 误把一个非 BMP 字符计算为两个字符，不静默截断、不自动去除首尾空格；
2. 服务端使用 `@zxcvbn-ts/core` 与通用词典检查常见密码、字典词、键盘序列、连续字符和重复字符；只接受 zxcvbn 分数 2、3 或 4，分数 0 或 1 统一视为明显过于简单；
3. 将标准化后的邮箱或手机号、显示名称和 `CapaPort` 作为用户上下文交给强度评估器，拒绝可由这些信息轻易构造的密码；
4. 不要求同时出现大写、小写、数字或符号，不因字符类别单一直接拒绝；
5. 只有本地校验通过后才调用外部泄露检测，避免为明显无效输入产生外部请求和费用。

强度评估器使用固定版本依赖和可测试的确定性结果，不自行维护零散正则集合。zxcvbn 最低分数固定为 2，服务端判定为最终结果；前端不复制一套可能漂移的安全规则。依赖升级必须通过既有密码样例回归测试，避免同一版本内无意改变接受边界。

密码原文只用于本次请求中的策略判断、Google 隐私保护计算和 Argon2id 哈希，不写日志、不写数据库、不进入错误信息或遥测字段。密码哈希继续沿用现有 Argon2id 参数。

### Google 泄露凭据检测

新增 `PasswordRiskChecker` 接口，将业务流程与 Google Cloud 实现隔离。生产实现使用 Google 官方 TypeScript Password Check Helper 和 reCAPTCHA Enterprise Assessment API：

1. 使用标准化账号与原始密码在服务端生成查找哈希前缀和加密凭据哈希；
2. 只把隐私保护后的参数发送给 Google；
3. 在服务端本地验证 Google 返回的重新加密结果；
4. 命中泄露凭据时拒绝注册或重置。

Google 官方文档说明该流程使用安全多方计算保护用户数据，并建议 Password Defense assessment 使用 500 ms 超时。生产环境需要启用 Google Cloud billing、reCAPTCHA Enterprise Password Defense 和 Application Default Credentials。

配置边界：

- 生产环境启用注册或密码重置时，必须配置 Google Cloud Project ID 与凭据；缺失配置应在启动阶段失败，不得静默降级；
- 测试环境使用可注入的确定性假实现；
- 本地开发可以显式启用 `development` 假实现，但必须记录非敏感警告，不得在生产环境使用；
- Google 请求超时、限流或不可用时采用失败关闭策略，返回可重试的 503 错误，不把“未完成检测”当作“安全”。

### 注册数据流

1. 标准化邮箱或手机号；
2. 执行本地同步密码校验；
3. 执行 Google 泄露凭据检测；
4. 两项均通过后才进行 Argon2id 哈希并创建账号与验证挑战；
5. 任一步失败都不得创建用户、身份或验证挑战。

### 密码重置数据流

密码重置不能先永久消费验证码，再执行可能失败的 Google 检测。流程调整为两阶段：

1. 在数据库锁与尝试次数保护下验证恢复挑战，返回服务端保存的账号目标，但暂不标记为已消费；
2. 使用该账号目标执行本地密码校验和 Google 泄露检测；
3. 校验通过后，在事务中再次锁定并确认挑战仍有效，原子地消费挑战、更新密码并撤销已有会话；
4. 密码不合格或 Google 暂时不可用时，验证码保持可重试状态；错误验证码仍正常累计尝试次数。

这样既不信任客户端提交的账号，也不会因为密码不合格迫使用户重新获取验证码。

## API 与错误契约

保留稳定的错误信封结构，新增或细化以下业务错误：

| 错误码 | HTTP | `fieldErrors.password` 中文提示 |
| --- | ---: | --- |
| `AUTH_PASSWORD_TOO_SHORT` | 400 | 密码至少需要 8 个字符。 |
| `AUTH_PASSWORD_TOO_SIMPLE` | 400 | 该密码过于简单或容易被猜到，请换一个密码。 |
| `AUTH_PASSWORD_COMPROMISED` | 400 | 该密码曾出现在数据泄露中，请勿继续使用。 |
| `AUTH_PASSWORD_RISK_CHECK_UNAVAILABLE` | 503 | 暂时无法完成密码安全检查，请稍后重试。 |

顶层 `message` 同步改为中文兜底文本。Web 与 Desktop 优先展示 `fieldErrors.password` 的第一条；没有字段错误时才展示顶层 `message`。不得向用户暴露 Google 响应、项目标识、请求参数或内部异常。

登录流程不按新规则拒绝既有密码。未来如需在登录时检测泄露凭据，应另行设计提醒、MFA 与强制改密流程。

## Web 与 Desktop 交互

注册和重置密码输入框下方始终显示：

> 密码至少 8 个字符，可使用字母、数字和符号。请勿使用常见、容易猜测或已泄露的密码。

交互状态：

- 输入不足 8 位时即时显示“还需输入 N 个字符”；
- 达到 8 位后只显示“提交后将检查密码安全性”，不在客户端宣称密码已经安全；
- 提交期间显示“正在检查密码安全性…”并禁用重复提交；
- 服务端拒绝时在密码输入框附近显示对应中文字段错误；
- 注册、重置、Web 与 Desktop 使用相同文案；
- 保持 `autocomplete="new-password"`，允许粘贴、浏览器密码管理器和系统自动填充。

登录输入框不显示新密码创建规则，避免让既有用户误以为登录密码必须重新满足新策略。

## 安全与隐私

- Google 检测只发生在 API 服务端，Web 与 Desktop 不直接持有 Google Cloud 凭据；
- 不缓存、记录或持久化原始密码、派生查找参数和 Google 匹配候选；
- 日志只允许记录结果类别、延迟、超时和稳定错误码，不记录账号原文；
- Google 调用设定 500 ms 超时，并沿用现有注册、恢复和登录限流；
- 继续使用 Argon2id、唯一盐、会话撤销和验证码尝试次数限制；
- 8 位是本次确认的产品最低值。由于当前没有 MFA，这低于 OWASP 对无 MFA 密码的推荐长度，后续应通过 MFA、Passkey 或 SSO 提升整体认证强度。

## 测试与验收

### 单元测试

- 接受至少 8 个 Unicode code point、zxcvbn 分数不低于 2 的密码，不要求特定字符类别；
- 接受空格、Unicode 和密码管理器生成的长密码；
- 拒绝 7 位密码、常见密码、连续或重复模式、账号或显示名称派生密码；
- Google checker 的安全、泄露、超时和服务错误分支均有确定性测试；
- 断言错误信封包含稳定错误码和中文 `fieldErrors.password`；
- 断言日志和序列化错误中不出现密码或派生敏感参数。

### 服务测试

- 注册在本地或 Google 校验失败时不创建任何账号数据；
- 重置密码失败时验证码仍可重试；
- 重置成功时验证码消费、密码更新和会话撤销保持原子一致；
- Google 不可用时生产路径返回 503，不静默放行；
- 普通登录仍接受策略变更前创建的有效密码。

### UI 测试

- Web 与 Desktop 在注册和重置场景始终展示规则提示；
- 少于 8 位时显示剩余字符数；
- 四类服务端错误显示对应中文提示；
- 提交期间不可重复提交，并显示安全检查状态；
- 登录页面不错误展示创建密码规则。

## 参考

- Google Cloud Password Defense: <https://docs.cloud.google.com/recaptcha/docs/check-passwords>
- NIST SP 800-63B: <https://pages.nist.gov/800-63-4/sp800-63b.html>
- OWASP Authentication Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- OWASP Password Storage Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
