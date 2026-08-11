# README Donation Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved Alipay and WeChat donation section to the public README with repository-owned image assets.

**Architecture:** Store the two user-provided JPEG files under a dedicated documentation asset directory and reference them from a small HTML table in README.md. Preserve the original image bytes and dimensions so QR recognition is not affected.

**Tech Stack:** GitHub Markdown, HTML table markup, JPEG assets, shell-based file and link verification.

## Global Constraints

- Place the section between “参与项目” and “许可”.
- Use the exact asset paths `docs/assets/donate/alipay.jpg` and `docs/assets/donate/wechat-pay.jpg`.
- Preserve the original image bytes without cropping, recompression, or QR modification.
- Render each image at width `280` with the labels “支付宝” and “微信支付”.
- Do not add sponsor tiers, promised rewards, amount guidance, scripts, or external payment links.

---

### Task 1: Add donation assets and README section

**Files:**
- Create: `docs/assets/donate/alipay.jpg`
- Create: `docs/assets/donate/wechat-pay.jpg`
- Modify: `README.md`
- Verify: `docs/superpowers/specs/2026-08-11-readme-donation-design.md`

**Interfaces:**
- Consumes: the two original clipboard JPEG files supplied by the user.
- Produces: stable repository-relative image paths consumed directly by GitHub's README renderer.

- [ ] **Step 1: Create the asset directory and copy the original files without transformation**

```bash
mkdir -p docs/assets/donate
cp /var/folders/wg/g67vj_9x4tb3lkt82wc0bx700000gn/T/codex-clipboard-c7eab38c-0639-4796-b7ce-c59edb6247f8.jpg docs/assets/donate/alipay.jpg
cp /var/folders/wg/g67vj_9x4tb3lkt82wc0bx700000gn/T/codex-clipboard-6ad8a796-61b3-4c94-9aad-fb96b61c3ee8.jpg docs/assets/donate/wechat-pay.jpg
```

- [ ] **Step 2: Verify copied bytes match the supplied images**

Run:

```bash
shasum -a 256 docs/assets/donate/alipay.jpg docs/assets/donate/wechat-pay.jpg
sips -g pixelWidth -g pixelHeight -g format docs/assets/donate/alipay.jpg docs/assets/donate/wechat-pay.jpg
```

Expected:

```text
3c213def4b1f3da5816f2bdbfd46a697215ad27adc1b452ec6a233d5384c0caa  docs/assets/donate/alipay.jpg
b972cc4cc1e72bcaedeea9b298c74fab9b6a57d7784a1a85bde3514a70dafade  docs/assets/donate/wechat-pay.jpg
alipay.jpg: JPEG, 1280 x 1919
wechat-pay.jpg: JPEG, 828 x 1124
```

- [ ] **Step 3: Add the approved README section**

Insert between “参与项目” and “许可”:

```html
## 支持项目

如果 CapaPort 对你有帮助，可以请作者喝杯咖啡。感谢你的支持，这会帮助项目持续维护和迭代。

<table>
  <tr>
    <th>支付宝</th>
    <th>微信支付</th>
  </tr>
  <tr>
    <td><img src="docs/assets/donate/alipay.jpg" alt="支付宝收款码" width="280" /></td>
    <td><img src="docs/assets/donate/wechat-pay.jpg" alt="微信支付收款码" width="280" /></td>
  </tr>
</table>
```

- [ ] **Step 4: Verify paths, formatting, and scope**

Run:

```bash
test -f docs/assets/donate/alipay.jpg
test -f docs/assets/donate/wechat-pay.jpg
rg -n 'docs/assets/donate/(alipay|wechat-pay)\.jpg' README.md
pnpm format:check
git diff --check
git status --short
```

Expected: both files exist, README contains both paths, formatting and diff checks exit `0`, and only README, the two images, and this plan are uncommitted.

- [ ] **Step 5: Commit and push the completed batch**

```bash
git add README.md docs/assets/donate/alipay.jpg docs/assets/donate/wechat-pay.jpg docs/superpowers/plans/2026-08-11-readme-donation.md
git commit -m "docs: add project donation options"
git push origin main
```

Expected: local `HEAD` equals `git ls-remote origin refs/heads/main` after the push.
