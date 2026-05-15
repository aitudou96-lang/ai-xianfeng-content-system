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

const INSUFFICIENT = "信息不足，建议人工补充";

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

function analysisText(record) {
  return [
    record["标题"],
    record["视频文案"],
    record["封面文字"]
  ].map(normalize).filter(Boolean).join(" ");
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
}

function parseMetric(value) {
  const text = normalize(value).replace(/,/g, "");
  const match = text.match(/(\d+(?:\.\d+)?)(万|w|W)?/);
  if (!match) return 0;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return 0;
  return match[2] ? Math.round(number * 10000) : Math.round(number);
}

function engagementSummary(record) {
  const metrics = [
    ["点赞", parseMetric(record["点赞数"])],
    ["评论", parseMetric(record["评论数"])],
    ["收藏", parseMetric(record["收藏数"])],
    ["转发", parseMetric(record["转发数"])]
  ].filter(([, value]) => value > 0);
  return metrics.length ? metrics.map(([name, value]) => `${name}${value}`).join("、") : "";
}

function hasHighEngagement(record) {
  return [
    record["点赞数"],
    record["评论数"],
    record["收藏数"],
    record["转发数"]
  ].some((value) => parseMetric(value) >= 10000);
}

function inferHook(record) {
  const title = normalize(record["标题"]);
  const coverText = normalize(record["封面文字"]);
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasAny(text, ["盘点一周AI大事", "一周AI大事"])) {
    return "一分钟看完一周 AI 大事，用高密度工具更新和趋势变化制造开场吸引力。";
  }
  if (title) return `围绕「${shortText(title, 60)}」开场，先抛出这条内容和普通人 AI 机会的关系。`;
  if (coverText) return `围绕封面文字「${shortText(coverText, 60)}」开场，先明确用户为什么要继续看。`;
  return INSUFFICIENT;
}

function inferTopicType(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasAny(text, ["AI", "Claude", "OpenAI", "Codex", "Gemini", "模型", "智能体", "数字人"])) {
    if (hasAny(text, ["盘点", "一周", "大事", "发布", "上线", "开源"])) return "AI工具 / 热点跟进 / 趋势盘点";
    if (hasAny(text, ["视频", "口播", "内容", "设计", "代码", "图像"])) return "AI工具 / 内容生产 / 案例拆解";
    return "AI工具 / 热点跟进";
  }
  return INSUFFICIENT;
}

function inferConflict(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasAny(text, ["接管", "人人都能", "消灭", "老板", "取代", "不用请", "交棒给AI"])) {
    return "AI 工具能力快速扩张，与普通人、创作者和商家仍依赖手工流程之间的冲突。";
  }
  if (hasAny(text, ["AI", "模型", "工具"])) {
    return "AI 更新速度很快，但普通人不知道哪些变化值得关注、学习和落地。";
  }
  return INSUFFICIENT;
}

function inferEmotion(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasAny(text, ["王炸", "最强", "逆天", "彻底", "消灭", "不用请", "AI老板"])) {
    return "震惊感、紧迫感、错过焦虑，以及对 AI 替代速度的好奇。";
  }
  if (hasHighEngagement(record)) return "高信息密度带来的收藏、转发和继续关注冲动。";
  return INSUFFICIENT;
}

function inferBenefit(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasAny(text, ["设计", "代码", "视频", "图像", "语音", "数字人", "内容"])) {
    return "帮助用户快速了解哪些 AI 工具可能提升设计、编码、视频制作、口播和内容生产效率。";
  }
  if (hasAny(text, ["AI", "模型", "工具"])) return "帮助用户筛选 AI 工具变化，减少盲目追热点。";
  return INSUFFICIENT;
}

function inferCta(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasAny(text, ["工具", "模型", "AI", "智能体"])) {
    return "可引导用户评论最想深入了解的工具，或私信获取 AI 工具落地清单。";
  }
  return INSUFFICIENT;
}

function inferViralReason(record) {
  const text = analysisText(record);
  const engagement = engagementSummary(record);
  if (!text && !engagement) return INSUFFICIENT;
  const reasons = [];
  if (hasAny(text, ["盘点", "一周", "大事"])) reasons.push("一条内容集中打包多条 AI 更新，信息密度高");
  if (hasAny(text, ["最强", "王炸", "接管", "消灭", "人人都能"])) reasons.push("标题和表达带有强冲突、强情绪词");
  if (hasAny(text, ["设计", "代码", "视频", "图像", "语音", "数字人"])) reasons.push("覆盖多个可落地的内容生产和工具应用场景");
  if (engagement) reasons.push(`可见互动数据较强（${engagement}）`);
  return reasons.length ? reasons.join("；") : INSUFFICIENT;
}

function inferXianfengAngle(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasAny(text, ["视频", "口播", "设计", "代码", "图像", "数字人", "内容", "工具"])) {
    return "可改写为普通人如何把 AI 工具接入选题、脚本、口播、设计或视频生产流程，服务流量、信任和工具演示承接。";
  }
  return INSUFFICIENT;
}

function inferXianfengzheAngle(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasAny(text, ["AI", "模型", "智能体", "OpenAI", "Claude", "Gemini", "Codex"])) {
    return "可做成 AI 趋势判断：AI 正从单点工具走向多模态和工作流，普通人要看懂机会、误区和长期能力变化。";
  }
  return INSUFFICIENT;
}

function inferAccountPool(record) {
  const text = analysisText(record);
  if (!normalize(record["账号名"]) || !text) return INSUFFICIENT;
  if (hasAny(text, ["AI", "模型", "工具", "智能体"])) {
    return "待人工确认：账号内容与 AI 工具和趋势强相关，可先作为账号监控池候选。";
  }
  return INSUFFICIENT;
}

function inferViralPool(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasHighEngagement(record) || hasAny(text, ["盘点", "最强", "王炸", "接管", "一周AI大事"])) {
    return "是：信息密度、情绪强度和可见互动数据都适合进入爆款拆解池候选。";
  }
  return "待人工确认：需要补充更多互动和评论信息后判断。";
}

function inferTodaySuggestion(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  if (hasAny(text, ["AI", "模型", "工具", "智能体", "视频", "内容"])) {
    return "待人工确认：可作为今日内容建议候选，但需要先核验时效、事实准确性和账号适配度。";
  }
  return INSUFFICIENT;
}

function inferRisk(record) {
  const text = analysisText(record);
  if (!text) return INSUFFICIENT;
  const risks = [
    "需要人工核验视频发布时间、工具名称和信息真实性",
    "只能学习结构、选题和方法，不能复制原作者核心表达"
  ];
  if (hasAny(text, ["内测", "开源", "发布", "上线", "最强"])) risks.push("涉及产品发布和模型能力判断，发布前要复核时效");
  return risks.join("；");
}

function inferField(record, fieldName) {
  const inferences = {
    "前3秒钩子": inferHook,
    "选题类型": inferTopicType,
    "核心冲突": inferConflict,
    "情绪点": inferEmotion,
    "利益点": inferBenefit,
    "结尾CTA": inferCta,
    "爆款原因": inferViralReason,
    "适合AI先锋的角度": inferXianfengAngle,
    "适合AI先锋者的角度": inferXianfengzheAngle,
    "是否适合进入账号监控池": inferAccountPool,
    "是否适合进入爆款拆解池": inferViralPool,
    "是否适合进入今日内容建议": inferTodaySuggestion,
    "风险备注": inferRisk
  };
  const infer = inferences[fieldName];
  return infer ? infer(record) : INSUFFICIENT;
}

function analyzedDisplay(record, fieldName) {
  const original = normalize(record[fieldName]);
  if (original) return original;
  return `系统初判：${inferField(record, fieldName)}`;
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
- 前3秒钩子：${analyzedDisplay(record, "前3秒钩子")}
- 评论区高频问题：${display(record["评论区高频问题"])}`).join("\n\n");
}

function analysisSection(records) {
  if (!records.length) return "- 暂无数据行。";
  return records.map((record, index) => `### 样本 ${index + 1}

- 选题类型：${analyzedDisplay(record, "选题类型")}
- 核心冲突：${analyzedDisplay(record, "核心冲突")}
- 情绪点：${analyzedDisplay(record, "情绪点")}
- 利益点：${analyzedDisplay(record, "利益点")}
- 结尾CTA：${analyzedDisplay(record, "结尾CTA")}
- 爆款原因：${analyzedDisplay(record, "爆款原因")}`).join("\n\n");
}

function accountAngleSection(records) {
  if (!records.length) return "- 暂无数据行。";
  return records.map((record, index) => `### 样本 ${index + 1}

- 适合 AI先锋 的角度：${analyzedDisplay(record, "适合AI先锋的角度")}
- 适合 AI先锋者 的角度：${analyzedDisplay(record, "适合AI先锋者的角度")}`).join("\n\n");
}

function candidateSection(records) {
  if (!records.length) return "- 暂无数据行。";
  return records.map((record, index) => `### 样本 ${index + 1}

- 是否适合进入账号监控池：${analyzedDisplay(record, "是否适合进入账号监控池")}
- 是否适合进入爆款拆解池：${analyzedDisplay(record, "是否适合进入爆款拆解池")}
- 是否适合进入今日内容建议：${analyzedDisplay(record, "是否适合进入今日内容建议")}
- 风险备注：${analyzedDisplay(record, "风险备注")}`).join("\n\n");
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
