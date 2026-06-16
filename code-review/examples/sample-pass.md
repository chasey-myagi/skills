# 样例：干净的小改动 → 稳健 PASS

> 这是 **code-review** 的一次真实运行产物（独立 reviewer agent 实际输出，未编辑）。
> 它展示了 N/A 机制：一个纯本地数值解析的改动，没有攻击面、也没有独立 spec，
> reviewer 把「安全性」「需求符合」诚实标为 N/A、把权重重分配给适用维度，
> 得到一个不靠硬凑的稳健 PASS。

## 输入

变更：`src/config.ts`，+11/-3 行。给端口解析加默认值与范围校验。无 spec、无测试。

```diff
-export function parsePort(raw: string): number {
-  return parseInt(raw, 10);
-}
+export function parsePort(raw: string | undefined): number {
+  if (raw === undefined || raw.trim() === "") {
+    return 3000;
+  }
+  const port = parseInt(raw, 10);
+  if (Number.isNaN(port) || port < 1 || port > 65535) {
+    return 3000;
+  }
+  return port;
+}
```

## 输出（reviewer 报告）

### Scores

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Correctness | 8.5 | 25% | 2.50 |
| Security | N/A | — | — |
| Architecture | 8.0 | 20% | 1.88 |
| Error Handling | 7.5 | 15% | 1.32 |
| Maintainability | 7.0 | 15% | 1.24 |
| Requirements Fit | N/A | — | — |
| **Final Score** | | | **8.05** |

> **Security → N/A**：该函数只对一个已在本进程环境的字符串做数值解析与范围校验，不接触网络输入、反序列化、认证授权、命令/SQL/路径拼接。没有可评估的攻击面。
> **Requirements Fit → N/A**：本次没有任何独立 spec / 计划文档，从 diff 反推需求是循环论证。
> **权重重分配**：N/A 掉 Security(15%)+Requirements(10%)，剩余 4 维 (25/20/15/15，和 75%) 各除以 0.75 归一化为 33.33/26.67/20/20。Final = 8.5×0.3333 + 8.0×0.2667 + 7.5×0.20 + 7.0×0.20 = **8.05**。

### Result: PASS ✅

- 适用维度 Correctness(8.5)、Architecture(8.0)、Error Handling(7.5)、Maintainability(7.0) 全部 ≥ 7.0 ✅
- Final 8.05 ≥ 7.5 ✅；无 Critical issue ✅

### Issues

**Minor**
1. **默认端口 3000 是重复出现的魔法数字** — `src/config.ts:3` 与 `:8`。抽 `const DEFAULT_PORT = 3000;`。
2. **`parseInt` 接受尾随垃圾** — `parseInt("80abc", 10)` 返回 `80`。如需严格，用 `/^\d+$/.test(raw.trim())` 预检。

### Assessment

**Ready to merge?** Yes（建议附带抽取 `DEFAULT_PORT` 常量）
**Reasoning:** 逻辑正确、边界精确、无安全/正确性风险；唯一真实改进点是消除重复魔法数字，不构成阻塞。

---

> 对照：在加入 N/A 机制之前，同一个改动会被迫给 Security / Requirements 硬凑分数
> （约 7.5 / 8.5），final ≈ 7.89 —— 一个**侥幸** PASS，余量全靠两个不适用维度撑。
> 而一个诚实给中位分（安全 5.0）的 reviewer 会让它直接 FAIL。N/A 机制消除了这种取决于
> 审查者宽严的不确定性。
