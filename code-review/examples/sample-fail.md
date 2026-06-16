# 样例：伪装成「重构」的 SQL 注入 → FAIL

> 这是 **code-review** 的一次真实运行产物（独立 reviewer agent 实际输出，未编辑）。
> 改动声称「把字符串拼接改成模板字符串，提升可读性」，但模板字符串不提供任何转义，
> 注入面分毫未减。它展示了 N/A 机制**不会**被滥用成安全后门：这里安全维度照常生效、
> 严格打低分、判 Critical。

## 输入

变更：`src/users.ts`，+2/-1 行。`name` 来自 `GET /users?name=...` 的未处理 HTTP 参数。

```diff
 export async function findUser(db, name: string) {
-  return db.query("SELECT * FROM users WHERE name = '" + name + "'");
+  const sql = `SELECT * FROM users WHERE name = '${name}'`;
+  return db.query(sql);
 }
```

## 输出（reviewer 报告）

### Scores

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Correctness | 3.0 | 25% | — |
| Security | 1.5 | 15% | — |
| Architecture | 6.0 | 20% | — |
| Error Handling | N/A | — | — |
| Maintainability | 7.0 | 15% | — |
| Requirements Fit | N/A | — | — |
| **Final Score** | | | **4.30** |

> N/A：**Error Handling**（本次 diff 未触碰任何错误处理路径）、**Requirements Fit**（无独立 spec）。
> 适用维度 Correctness/Security/Architecture/Maintainability (25/15/20/15，和 75%) 归一化后计算，Final = **4.30**。

### Result: FAIL ❌

任一条都足以判 FAIL，本次全中：
- **Security = 1.5**（< 7.0）：可直接利用的 SQL 注入。
- **Correctness = 3.0**（< 7.0）。
- **Final = 4.30**（< 7.5）。
- 存在 1 个未解决 **Critical**。

### Issues

**Critical**
1. **SQL 注入（不可信 HTTP 参数直接拼入 SQL）** — `src/users.ts:2`
   - Issue: 模板字符串 `${name}` 只是字符串插值，**不提供转义**，与原来的 `+` 拼接在安全性上完全等价，注入面分毫未减。
   - Impact: 攻击者可构造 `name=' OR '1'='1`（dump 全表）、`name='; DROP TABLE users; --`（破坏数据）。可远程、无需认证直接利用。
   - Fix: 用参数化查询：`db.query("SELECT * FROM users WHERE name = $1", [name])`。

**Minor**
1. **`SELECT *` 可能取出 `password_hash` 等敏感列** — 显式列出所需列。

### Assessment

**Ready to merge?** No
**Reasoning:** 这次「重构」把 `+` 换成模板字符串，对 SQL 注入毫无缓解作用，必须改为参数化查询后才能合并。
