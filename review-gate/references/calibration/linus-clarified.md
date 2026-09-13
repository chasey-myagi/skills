# 更新措辞后的独立静态复核

重新读取更新后的 linus-reviewer.md 与原始 calibration-inputs.json，仅静态评估 A/B/C/F；未运行代码、测试或外部服务，原始报告保持不变。

- **A / diff：Applied.，通过。** 无可证明的新增或加重缺陷。缺少 spec、测试不能自行成为阻塞项；`parseInt` 接受数字前缀是既有行为。Human Callout：`src/config.ts` 新增可选入参和默认端口 3000 的回退行为。无必要的可选简化。
- **B / diff：Applied.，通过。** 两种写法生成相同 SQL。直接拼接原始输入的注入问题属于未加重的基线问题，仅作信息记录，不进入本次 findings 或改变整体评级。Human Callouts：无。无必要的可选简化。
- **C / diff：Please fix and resend.，NAK。** **C-01，P1，blocking: true**：`src/users.ts` 片段第 2-3 行取消参数绑定。输入 `"' OR TRUE --"` 将精确姓名匹配变为恒真条件；`O'Reilly` 破坏 SQL 字符串。恢复原有 `$1` 参数绑定即可，无需扩大改动。无独立的可选简化或 Human Callout。
- **F / snapshot：Please fix and resend.，NAK。** **F-01，P1，blocking: true**：`src/users.ts` 片段第 2-3 行存在同样的 SQL 拼接缺陷，违反当前精确姓名查询契约。应使用实际驱动支持的参数绑定；输入未指定驱动，不能冒认占位符语法。无独立的可选简化或 Human Callout。

四例评级与技术归因均未改变。更新后的“有严重问题；修复规模由问题决定，不为评级扩大改动”已消除我先前指出的严重程度与修复规模混用歧义。本次未发现新的 rubric 矛盾；这项确认不表示执行验证通过。
