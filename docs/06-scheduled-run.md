# Windows 定时运行说明

更新日期：2026-05-15

## 1. 目标说明

本阶段目标是用 Windows 本地“任务计划程序”每天定时运行已有的 `collect:daily` 流程，不修改采集逻辑，不新增后台服务。

每天自动运行：

```powershell
npm run collect:daily
```

运行后自动生成或更新：

- `outputs/ai_daily_brief_YYYY-MM-DD.md`
- `outputs/learning/daily_learning_log_YYYY-MM-DD.md`
- `outputs/learning/weekly_review_YYYY-WW.md`
- `outputs/learning/monthly_methodology_upgrade_YYYY-MM.md`
- `data/daily/*.csv`

项目目录：

```text
E:\Codex位置\New project 3
```

## 2. 推荐运行时间

建议每天上午固定时间运行，例如 `09:00`。

如果当天直播、拍摄、复盘或选题时间不同，可以把任务计划程序里的开始时间调整到更适合的时间。建议固定在每天内容生产前运行，方便先查看日报、学习记录和待观察方向。

## 3. Windows 任务计划程序设置步骤

1. 打开 Windows 开始菜单，搜索并打开“任务计划程序”。
2. 点击右侧“创建基本任务”。
3. 名称建议填写：`AI先锋每日内容中台采集`。
4. 触发器选择“每天”。
5. 设置开始日期和开始时间，例如每天 `09:00`。
6. 操作选择“启动程序”。
7. 程序或脚本填写：

```text
powershell.exe
```

8. 添加参数填写：

```text
-NoProfile -ExecutionPolicy Bypass -Command "cd 'E:\Codex位置\New project 3'; npm run collect:daily"
```

9. 起始位置填写项目目录：

```text
E:\Codex位置\New project 3
```

10. 点击完成。
11. 创建后可以在任务计划程序中右键该任务，选择“运行”，手动测试一次。

## 4. 推荐 PowerShell 执行命令

任务计划程序中推荐使用以下参数：

```powershell
-NoProfile -ExecutionPolicy Bypass -Command "cd 'E:\Codex位置\New project 3'; npm run collect:daily"
```

如果需要手动测试，可以先打开 PowerShell，执行：

```powershell
cd 'E:\Codex位置\New project 3'
npm run collect:daily
```

## 5. 运行前检查

首次设置定时任务前，建议确认：

- Node.js 已安装。
- `npm` 可用。
- 项目依赖已安装。
- `package.json` 中存在 `collect:daily` 命令。
- 网络可以访问公开信息源。
- 不要打开占用 CSV 的 WPS、Excel 或其他表格软件。
- 如果 CSV 被 WPS 或 Excel 占用，系统已有备用写入机制，会尝试写入备用文件。

## 6. 运行后检查路径

每天任务运行后，优先检查以下文件：

- `outputs/ai_daily_brief_当天日期.md`
- `outputs/learning/daily_learning_log_当天日期.md`
- `outputs/learning/weekly_review_当前周.md`
- `outputs/learning/monthly_methodology_upgrade_当前月份.md`
- `data/daily/source_health_当天日期.csv`

示例：

- `outputs/ai_daily_brief_2026-05-15.md`
- `outputs/learning/daily_learning_log_2026-05-15.md`
- `outputs/learning/weekly_review_2026-W20.md`
- `outputs/learning/monthly_methodology_upgrade_2026-05.md`
- `data/daily/source_health_2026-05-15.csv`

## 7. 失败处理

信息源读取失败不等于任务失败。

如果部分公开信息源读取失败，系统会在 `source_health` 中记录失败原因。常见情况包括：

- 网络失败。
- 公开源暂时不可访问。
- 请求超时。
- `Operation aborted`。
- 公开页面结构变化，导致无法识别条目。

处理原则：

- 不绕过平台限制。
- 不绕过登录、验证码或平台风控。
- 不访问未授权数据。
- 不因为单个信息源失败就判定整次定时任务失败。
- 先查看 `data/daily/source_health_当天日期.csv` 判断失败原因。

如果 `npm run collect:daily` 本身失败：

1. 手动打开 PowerShell。
2. 进入项目目录：

```powershell
cd 'E:\Codex位置\New project 3'
```

3. 手动运行：

```powershell
npm run collect:daily
```

4. 根据命令行错误处理。

如果出现权限失败：

- 用管理员权限打开 PowerShell 后再手动运行。
- 检查项目目录权限。
- 检查 Git 或 `.git` 目录权限。
- 检查是否有安全软件阻止写入。

如果 CSV 被 WPS 或 Excel 占用：

- 优先关闭占用中的表格文件。
- 如果暂时不能关闭，系统已有备用写入机制，会尝试写入备用文件。
- 运行后检查命令输出和 `source_health`，确认实际写入路径。

## 8. 合规边界

当前定时任务只运行公开信息源采集和本地报告生成。

明确边界：

- 只读取公开信息源。
- 不登录平台。
- 不绕过验证码。
- 不绕过平台风控。
- 不抓取未授权数据。
- 不接抖音自动抓取。
- 不自动操作平台账号。
- 不发布内容。
- 不发送私信。

后续如果做浏览器插件或授权页面信息整理工具，只能读取用户授权范围内、当前页面已经可见的信息，并且遇到登录、验证码、权限限制或平台风控时必须暂停并提示人工处理。

## 9. 当前阶段边界

本阶段只新增 Windows 定时运行说明文档。

本阶段不做：

- 不修改采集逻辑。
- 不新增后台服务。
- 不新增 npm 命令。
- 不改日报结构。
- 不改每日学习记录结构。
- 不改每周复盘结构。
- 不改月度方法论升级结构。
- 不做插件。
- 不接抖音自动抓取。
- 不改账号监控池。
