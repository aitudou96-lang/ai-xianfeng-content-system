const fs = require("node:fs/promises");
const path = require("node:path");

const INPUT_CSV = path.join("data", "manual", "visible_page_observations.csv");
const OUTPUT_DIR = path.join("outputs", "monitoring");
const FALLBACK_DATE = "2026-05-15";

const AUTO_ANALYSIS_FIELDS = [
  "前3秒钩子",
  "评论区高频问题",
  "选题类型",
  "核心冲突",
  "情绪点",
  "利益点",
  "结尾CTA",
  "爆款原因",
  "适合AI先锋的角度",
  "适合AI先锋者的角度",
  "是否适合进入账号监控池",
  "是否适合进入爆款拆解池",
  "是否适合进入今日内容建议",
  "风险备注",
  "缺失字段"
];

const USER_SUPPLEMENT_FIELDS = [
  "平台",
  "账号名",
  "主页链接",
  "视频链接",
  "标题",
  "发布时间",
  "视频播放量",
  "点赞数",
  "评论数",
  "收藏数",
  "转发数",
  "视频文案",
  "封面文字",
  "人工确认状态"
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((items) => items.some((item) => item.trim()));
}

function normalize(value) {
  return (value || "").toString().trim();
}

function display(value) {
  return normalize(value) || "待补充";
}

function shortText(value, maxLength = 300) {
  const normalized = display(value).replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function fieldBlock(row, fieldName) {
  const value = display(row[fieldName]);
  if (value === "待补充") return "- 待补充";
  return `\`\`\`text\n${value}\n\`\`\``;
}

function toRecords(rows) {
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function outputDate(records) {
  const rawDate = normalize(records[0] && records[0]["日期"]);
  const match = rawDate.match(/(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (!match) return FALLBACK_DATE;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function countBy(records, fieldName) {
  const counts = new Map();
  for (const record of records) {
    const key = display(record[fieldName]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => `- ${key}：${count} 条`).join("\n") || "- 待补充";
}

function missingFields(record, headers) {
  return headers.filter((header) => !normalize(record[header]));
}

function missingOverview(records, headers) {
  if (!records.length) return "- 暂无数据行，无法统计缺失字段。";
  return records.map((record, index) => {
    const missing = missingFields(record, headers);
    return `- 第 ${index + 1} 条：${missing.length ? missing.join("、") : "无缺失字段"}`;
  }).join("\n");
}

function fieldList(fields, record) {
  const missing = fields.filter((field) => !normalize(record[field]));
  return missing.length ? missing.join("、") : "暂无";
}

function linkFor(record) {
  return display(record["视频链接"] || record["主页链接"]);
}

function sampleSection(records) {
  if (!records.length) return "- 暂无数据行。";
  return records.map((record, index) => `### 样本 ${index + 1}

- 平台：${display(record["平台"])}
- 页面类型：${display(record["页面类型"])}
- 账号名：${display(record["账号名"])}
- 标题：${shortText(record["标题"], 180)}
- 发布时间：${display(record["发布时间"])}
- 链接：${linkFor(record)}`).join("\n\n");
}

function interactionSection(records) {
  if (!records.length) return "- 暂无数据行。";
  return records.map((record, index) => `### 样本 ${index + 1}

- 播放量：${display(record["视频播放量"])}
- 点赞数：${display(record["点赞数"])}
- 评论数：${display(record["评论数"])}
- 收藏数：${display(record["收藏数"])}
- 转发数：${display(record["转发数"])}`).join("\n\n");
}

function contentSection(records) {
  if (!records.length) return "- 暂无数据行。";
  return records.map((record, index) => `### 样本 ${index + 1}

- 视频文案：
${fieldBlock(record, "视频文案")}

- 封面文字：${display(record["封面文字"])}
- 前3秒钩子：${display(record["前3秒钩子"])}
- 评论区高频问题：${display(record["评论区高频问题"])}`).join("\n\n");
}

function analysisSection(records) {
  if (!records.length) return "- 暂无数据行。";
  return records.map((record, index) => `### 样本 ${index + 1}

- 选题类型：${display(record["选题类型"])}
- 核心冲突：${display(record["核心冲突"])}
- 情绪点：${display(record["情绪点"])}
- 利益点：${display(record["利益点"])}
- 结尾CTA：${display(record["结尾CTA"])}
- 爆款原因：${display(record["爆款原因"])}`).join("\n\n");
}

function accountAngleSection(records) {
  if (!records.length) return "- 暂无数据行。";
  return records.map((record, index) => `### 样本 ${index + 1}

- 适合 AI先锋 的角度：${display(record["适合AI先锋的角度"])}
- 适合 AI先锋者 的角度：${display(record["适合AI先锋者的角度"])}`).join("\n\n");
}

function candidateSection(records) {
  if (!records.length) return "- 暂无数据行。";
  return records.map((record, index) => `### 样本 ${index + 1}

- 是否适合进入账号监控池：${display(record["是否适合进入账号监控池"])}
- 是否适合进入爆款拆解池：${display(record["是否适合进入爆款拆解池"])}
- 是否适合进入今日内容建议：${display(record["是否适合进入今日内容建议"])}`).join("\n\n");
}

function supplementSection(records, headers) {
  if (!records.length) {
    return `- 缺失字段：暂无数据行，建议先补充至少 1 条人工授权页面可见信息。
- 建议后续由系统自动分析：${AUTO_ANALYSIS_FIELDS.join("、")}
- 需要用户人工补充：${USER_SUPPLEMENT_FIELDS.join("、")}`;
  }

  return records.map((record, index) => `### 样本 ${index + 1}

- 缺失字段：${fieldList(headers, record)}
- 建议后续由系统自动分析：${fieldList(AUTO_ANALYSIS_FIELDS, record)}
- 需要用户人工补充：${fieldList(USER_SUPPLEMENT_FIELDS, record)}`).join("\n\n");
}

function buildEmptySummary(dateText, csvPath) {
  return `# 授权页面可见信息整理摘要 ${dateText}

## 一、输入概况

- CSV 路径：${csvPath}
- 数据行数：0
- 人工确认状态概况：暂无数据行
- 缺失字段概况：暂无数据行

## 二、可见页面样本

- 暂无数据行。

## 三、可见互动数据

- 暂无数据行。

## 四、内容要点整理

- 暂无数据行。

## 五、初步分析

- 暂无数据行。

## 六、双账号可用角度

- 暂无数据行。

## 七、候选建议

- 暂无数据行。

## 八、缺失字段和人工补充提醒

- 缺失字段：暂无数据行，建议先补充至少 1 条人工授权页面可见信息。
- 建议后续由系统自动分析：${AUTO_ANALYSIS_FIELDS.join("、")}
- 需要用户人工补充：${USER_SUPPLEMENT_FIELDS.join("、")}

## 九、合规边界

- 本摘要只基于用户授权、当前页面可见、CSV 手动输入信息。
- 不读取未授权数据。
- 不绕过登录、验证码、权限限制或平台风控。
- 不自动访问平台页面。
- 不自动抓取抖音或其他平台。
`;
}

function buildSummary(dateText, csvPath, headers, records) {
  if (!records.length) return buildEmptySummary(dateText, csvPath);

  return `# 授权页面可见信息整理摘要 ${dateText}

## 一、输入概况

- CSV 路径：${csvPath}
- 数据行数：${records.length}
- 人工确认状态概况：
${countBy(records, "人工确认状态")}
- 缺失字段概况：
${missingOverview(records, headers)}

## 二、可见页面样本

${sampleSection(records)}

## 三、可见互动数据

${interactionSection(records)}

## 四、内容要点整理

${contentSection(records)}

## 五、初步分析

${analysisSection(records)}

## 六、双账号可用角度

${accountAngleSection(records)}

## 七、候选建议

${candidateSection(records)}

## 八、缺失字段和人工补充提醒

${supplementSection(records, headers)}

## 九、合规边界

- 本摘要只基于用户授权、当前页面可见、CSV 手动输入信息。
- 不读取未授权数据。
- 不绕过登录、验证码、权限限制或平台风控。
- 不自动访问平台页面。
- 不自动抓取抖音或其他平台。
`;
}

async function main() {
  const root = process.cwd();
  const csvPath = path.join(root, INPUT_CSV);
  const csvText = await fs.readFile(csvPath, "utf8");
  const rows = parseCsv(csvText);
  const headers = rows[0] || [];
  const records = toRecords(rows);
  const dateText = outputDate(records);
  const outputDir = path.join(root, OUTPUT_DIR);
  const outputPath = path.join(outputDir, `visible_page_summary_${dateText}.md`);
  const relativeCsvPath = INPUT_CSV.replace(/\\/g, "/");
  const summary = buildSummary(dateText, relativeCsvPath, headers, records);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, summary, "utf8");
  console.log(`已生成：${path.relative(root, outputPath).replace(/\\/g, "/")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
