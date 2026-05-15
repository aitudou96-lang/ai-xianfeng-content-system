const fs = require("node:fs/promises");
const path = require("node:path");
const { serializeRows } = require("./csvStore");
const { todayString } = require("./monitoring");

const AI_NEWS_HEADERS = [
  "日期",
  "来源",
  "标题",
  "摘要",
  "链接",
  "关键词",
  "相关等级",
  "与AI先锋相关度",
  "与AI先锋者相关度",
  "判断原因",
  "是否适合做内容",
  "是否值得做成短视频",
  "建议内容类型",
  "可拍标题",
  "前3秒钩子",
  "适合账号",
  "是否适合承接799元AI口播智能体",
  "承接方式",
  "产品连接句",
  "不适合承接原因",
  "下一步动作",
  "一句话拍摄建议",
  "建议切入角度",
  "风险备注",
  "失败原因"
];

const HOT_MATERIAL_HEADERS = [
  "日期",
  "热点名称",
  "来源",
  "链接",
  "热点类型",
  "相关等级",
  "热度判断",
  "可延展方向",
  "可拍视频标题",
  "前3秒钩子建议",
  "适合账号",
  "内容用途",
  "是否适合承接799元AI口播智能体",
  "承接方式",
  "产品连接句",
  "不适合承接原因",
  "下一步动作",
  "一句话拍摄建议",
  "适合AI先锋还是AI先锋者",
  "适合流量/信任/转化",
  "可做视频角度",
  "不建议做的原因",
  "风险备注",
  "失败原因"
];

const SOURCE_HEALTH_HEADERS = [
  "日期",
  "来源名称",
  "来源链接",
  "是否读取成功",
  "失败原因",
  "是否建议保留",
  "是否需要我人工处理"
];

const TARGET_DIRECTIONS = [
  "AI口播",
  "AI内容生产",
  "AI智能体",
  "AI自动化",
  "AI工具应用",
  "AI创业",
  "AI变现",
  "自媒体提效",
  "知识付费",
  "个体创业者提效",
  "短视频运营",
  "私信转化",
  "直播承接"
];

const TARGET_KEYWORDS = [
  "ai",
  "artificial intelligence",
  "agent",
  "agents",
  "智能体",
  "口播",
  "内容生产",
  "content creation",
  "creator",
  "creators",
  "video",
  "short video",
  "短视频",
  "automation",
  "自动化",
  "workflow",
  "工作流",
  "tool",
  "工具",
  "app",
  "应用",
  "startup",
  "创业",
  "business",
  "monetization",
  "变现",
  "marketing",
  "营销",
  "knowledge",
  "知识付费",
  "course",
  "课程",
  "personal brand",
  "自媒体",
  "livestream",
  "live",
  "直播",
  "dm",
  "私信",
  "conversion",
  "转化",
  "efficiency",
  "提效",
  "productivity",
  "获客",
  "customer acquisition",
  "model",
  "模型",
  "openai",
  "chatgpt",
  "claude",
  "gemini"
];

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ITEMS_PER_SOURCE = 6;

function normalize(value) {
  return (value || "").toString().trim();
}

function stripHtml(value) {
  return normalize(
    decodeEntities(value)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
}

function decodeEntities(value) {
  return normalize(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return decodeEntities(match[1] || match[2] || "");
  }
  return "";
}

function resolveUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return normalize(href);
  }
}

function parseRssItems(xml, sourceUrl) {
  const itemBlocks = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  if (itemBlocks.length) {
    return itemBlocks.map((block) => {
      const title = firstMatch(block, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
      const link = firstMatch(block, [/<link[^>]*>([\s\S]*?)<\/link>/i, /<guid[^>]*>([\s\S]*?)<\/guid>/i]);
      const summary = firstMatch(block, [
        /<description[^>]*>([\s\S]*?)<\/description>/i,
        /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i
      ]);
      return {
        title: stripHtml(title),
        summary: stripHtml(summary),
        link: resolveUrl(sourceUrl, stripHtml(link))
      };
    });
  }

  return [...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)].map((match) => {
    const block = match[0];
    const title = firstMatch(block, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
    const summary = firstMatch(block, [
      /<summary[^>]*>([\s\S]*?)<\/summary>/i,
      /<content[^>]*>([\s\S]*?)<\/content>/i
    ]);
    const href = firstMatch(block, [/<link[^>]*href=["']([^"']+)["'][^>]*>/i]);
    return {
      title: stripHtml(title),
      summary: stripHtml(summary),
      link: resolveUrl(sourceUrl, href)
    };
  });
}

function parsePublicPage(html, sourceUrl) {
  const pageTitle = stripHtml(firstMatch(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]));
  const pageSummary = stripHtml(
    firstMatch(html, [
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i
    ])
  );
  const headings = [...html.matchAll(/<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => stripHtml(match[2]))
    .filter(Boolean)
    .slice(0, MAX_ITEMS_PER_SOURCE);

  const titles = headings.length ? headings : [pageTitle].filter(Boolean);
  return titles.map((title) => ({
    title,
    summary: pageSummary || "公开页面可见标题，建议人工打开确认上下文。",
    link: sourceUrl
  }));
}

function extractKeywords(text) {
  const dictionary = TARGET_KEYWORDS;
  const lower = text.toLowerCase();
  return dictionary
    .filter((keyword) => lower.includes(keyword.toLowerCase()))
    .slice(0, 8)
    .join("、") || "待人工标注";
}

function countMatches(text, words) {
  const lower = text.toLowerCase();
  return words.reduce((sum, word) => {
    const keyword = word.toLowerCase();
    if (/^[a-z0-9][a-z0-9\s-]*$/.test(keyword)) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      return sum + (new RegExp(`\\b${escaped}\\b`, "i").test(lower) ? 1 : 0);
    }
    return sum + (lower.includes(keyword) ? 1 : 0);
  }, 0);
}

const CORE_AI_WORDS = [
  "ai",
  "artificial intelligence",
  "openai",
  "chatgpt",
  "claude",
  "gemini",
  "模型",
  "model"
];

const BUSINESS_CORE_WORDS = [
  "口播",
  "内容生产",
  "content creation",
  "creator",
  "creators",
  "自媒体",
  "short video",
  "短视频",
  "script",
  "脚本",
  "文案",
  "获客",
  "私信",
  "dm",
  "直播",
  "livestream",
  "课程",
  "知识付费",
  "变现",
  "monetization",
  "转化",
  "conversion"
];

const TOOL_APPLICATION_WORDS = [
  "agent",
  "agents",
  "智能体",
  "automation",
  "自动化",
  "workflow",
  "工作流",
  "tool",
  "工具",
  "app",
  "应用",
  "productivity",
  "efficiency",
  "提效"
];

const BROAD_BUSINESS_WORDS = [
  "startup",
  "创业",
  "business",
  "商业",
  "marketing",
  "营销",
  "customer acquisition",
  "个体创业",
  "小老板"
];

function classifyRelevance(text, source) {
  const category = normalize(source.category);
  const coreAi = countMatches(text, CORE_AI_WORDS);
  const businessCore = countMatches(text, BUSINESS_CORE_WORDS);
  const toolApplication = countMatches(text, TOOL_APPLICATION_WORDS);
  const broadBusiness = countMatches(text, BROAD_BUSINESS_WORDS);
  const isWideStartupSource = /创业知识付费/.test(category);
  const isCreatorSource = /自媒体运营/.test(category);
  const isAiSource = /AI新闻|AI工具|AI产品发布/.test(category);
  let score = coreAi + businessCore * 2 + toolApplication * 2 + broadBusiness;

  if (isCreatorSource && (businessCore || toolApplication)) score += 2;
  if (isAiSource && (businessCore || toolApplication)) score += 1;
  if (isWideStartupSource && !coreAi && businessCore < 2 && !toolApplication) score -= 3;
  if (/supply chain attack|lawsuit|layoff|stock|ipo|fund|funding|venture|revenue/i.test(text) && businessCore === 0 && toolApplication === 0) {
    score -= 2;
  }

  const reasons = [];
  if (coreAi) reasons.push("有AI/模型/工具基础相关性");
  if (businessCore) reasons.push("命中内容生产、短视频、知识付费、转化或承接主线");
  if (toolApplication) reasons.push("命中智能体、自动化、工作流或工具应用");
  if (broadBusiness) reasons.push("命中创业、商业化或营销线索");
  if (!reasons.length) reasons.push("未命中当前业务主线");

  const level = score >= 6 ? "强相关" : score >= 3 ? "中相关" : "弱相关";
  return {
    level,
    score,
    coreAi,
    businessCore,
    toolApplication,
    broadBusiness,
    reason: reasons.join("；")
  };
}

function isStrongOrMedium(relevance) {
  return relevance.level === "强相关" || relevance.level === "中相关";
}

function relevanceLabel(score) {
  if (score >= 4) return "高";
  if (score >= 2) return "中";
  return "低";
}

function hasDirectConversionCue(text) {
  return /私信|dm|咨询|领取|直播|livestream|成交|转化|conversion|799|下单|课程|训练营|社群/i.test(text);
}

function hasMethodologyCue(text) {
  return /方法论|methodology|framework|框架|system|系统|workflow|工作流|automation|自动化|agent|智能体|case|案例|playbook|指南|how to|get started|教程|演示/i.test(text);
}

function analyzeFit(text, relevance = classifyRelevance(text, {})) {
  const xianfengScore = countMatches(text, [
    "tool",
    "工具",
    "automation",
    "自动化",
    "workflow",
    "工作流",
    "creator",
    "自媒体",
    "video",
    "视频",
    "marketing",
    "营销",
    "course",
    "课程",
    "business",
    "商业",
    "startup",
    "创业",
    "agent",
    "智能体",
    "live",
    "直播",
    "口播",
    "脚本",
    "短视频",
    "私信",
    "转化",
    "获客"
  ]);
  const xianfengzheScore = countMatches(text, [
    "model",
    "模型",
    "research",
    "研究",
    "industry",
    "行业",
    "trend",
    "趋势",
    "safety",
    "安全",
    "policy",
    "政策",
    "strategy",
    "战略",
    "future",
    "未来",
    "Claude",
    "Gemini",
    "OpenAI",
    "机会",
    "判断",
    "认知",
    "变现观察"
  ]);

  const targetScore = relevance.score;
  const adjustedXianfengScore = xianfengScore + relevance.businessCore + relevance.toolApplication;
  const adjustedXianfengzheScore = xianfengzheScore + relevance.coreAi + (relevance.broadBusiness > 0 ? 1 : 0);
  const accountFit =
    Math.abs(adjustedXianfengScore - adjustedXianfengzheScore) <= 2 && adjustedXianfengScore + adjustedXianfengzheScore >= 3
      ? "两个都适合"
      : adjustedXianfengScore > adjustedXianfengzheScore
        ? "AI先锋"
        : "AI先锋者";
  const directConversion = hasDirectConversionCue(text);
  const methodology = hasMethodologyCue(text);
  let goal = "观察";
  if (accountFit === "AI先锋者") {
    goal = directConversion && methodology ? "转化" : "信任";
  } else if (accountFit === "AI先锋") {
    goal = directConversion || /口播|脚本|短视频|教程|工具|智能体|agent|workflow|自动化/i.test(text) ? "转化" : "流量";
  } else if (directConversion && /口播|脚本|内容生产|教程|工具|智能体|agent|workflow|自动化/i.test(text)) {
    goal = "转化";
  } else if (adjustedXianfengzheScore >= adjustedXianfengScore || methodology) {
    goal = "信任";
  } else if (targetScore >= 2) {
    goal = "流量";
  }
  const reasons = [];
  if (/agent|智能体|workflow|自动化|automation/i.test(text)) reasons.push("涉及AI智能体/自动化");
  if (/creator|video|short video|自媒体|短视频|content creation|内容生产/i.test(text)) reasons.push("涉及内容生产/自媒体提效");
  if (/tool|工具|app|应用|model|模型|openai|chatgpt|claude|gemini/i.test(text)) reasons.push("涉及AI工具/模型变化");
  if (/startup|创业|business|monetization|变现|marketing|营销|course|课程|knowledge|知识付费/i.test(text)) reasons.push("涉及创业、知识付费或变现");
  if (/dm|私信|live|livestream|直播|conversion|转化/i.test(text)) reasons.push("涉及私信、直播或转化承接");
  if (!reasons.length) reasons.push("与当前双账号主线相关度不足");
  return {
    xianfeng: relevanceLabel(adjustedXianfengScore),
    xianfengzhe: relevanceLabel(adjustedXianfengzheScore),
    accountFit,
    goal,
    targetScore,
    reason: [...new Set(reasons)].join("；")
  };
}

function isRelevant(text, source) {
  return isStrongOrMedium(classifyRelevance(text, source));
}

function titleTopic(item, source) {
  const title = normalize(item.title).replace(/[|｜].*$/, "");
  const lower = title.toLowerCase();
  if (/[\u4e00-\u9fa5]/.test(title)) return title;
  if (/short-form|won.?t skip|attention/.test(lower) && /video|youtube|instagram|short/.test(lower)) {
    return "短视频如何提高停留和注意力";
  }
  if (/youtube/.test(lower)) return "YouTube内容工具如何放大注意力";
  if (/instagram/.test(lower)) return "Instagram内容工具如何带来流量";
  if (/claude code/.test(lower)) return "Claude Code如何进入普通人的AI工作流";
  if (/claude cowork/.test(lower)) return "Claude协作工具如何改变内容工作流";
  if (/gemini/.test(lower) && /file|generate/.test(lower)) return "Gemini开始帮你直接生成文件";
  if (/gemini/.test(lower) && /paper|note/.test(lower)) return "Gemini把纸质笔记变成可用素材";
  if (/gemini/.test(lower)) return "Gemini应用更新背后的AI工具机会";
  if (/codex/.test(lower) && /finance/.test(lower)) return "财务团队用Codex自动做业务报告";
  if (/codex/.test(lower) && /windows|sandbox/.test(lower)) return "Codex在Windows上跑通安全本地工作流";
  if (/codex/.test(lower)) return "Codex把AI智能体带进真实工作流";
  if (/workflow/.test(lower)) return "AI工作流正在替代重复操作";
  if (/agent|ai-assisted/.test(lower)) return "AI智能体开始进入真实生产场景";
  if (/\b(tool|app)\b/.test(lower)) return "AI工具更新正在改变内容生产";
  if (/training/.test(lower)) return "团队AI训练从尝鲜走向实战";
  if (/content|creator|creative/.test(lower)) return "创作者内容生产正在被AI重做一遍";
  if (/startup|founder|venture|fund/.test(lower)) return "AI创业热度背后的机会和噪音";
  return `${normalize(source.category) || "AI工具"}出现新变化`;
}

function titleStyleIndex(item, source) {
  const text = `${item.title} ${source.source_name}`;
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function shortTitle(item, fit, source) {
  const subject = titleTopic(item, source);
  const index = titleStyleIndex(item, source);
  if (/Codex在Windows/.test(subject)) {
    return fit.accountFit === "AI先锋"
      ? "别再只看工具更新了，Codex真正重做的是本地工作流"
      : "未来被AI拉开差距的，是能把工具变成工作流的人";
  }
  if (/AI智能体/.test(subject)) {
    return fit.accountFit === "AI先锋"
      ? "AI智能体真正值钱的地方，是把一个人的流程变成系统"
      : "AI智能体不是新工具，而是普通人工作方式的一次换挡";
  }
  if (/创作者内容生产/.test(subject)) {
    return fit.accountFit === "AI先锋"
      ? "如果你还在手动做内容，机器产能已经开始压过来了"
      : "创作者最危险的不是不会AI，而是内容产能被别人系统化";
  }
  if (/短视频如何提高停留/.test(subject)) {
    return fit.accountFit === "AI先锋"
      ? "短视频拼到最后，不是灵感，是谁更懂注意力系统"
      : "你以为短视频靠灵感，其实它越来越像一套注意力工程";
  }
  if (/Claude Code/.test(subject)) {
    return fit.accountFit === "AI先锋"
      ? "不会代码不是问题，看不懂AI工作流才是问题"
      : "Claude Code提醒普通人：未来不是人人写代码，而是人人调度AI";
  }
  if (/Instagram内容工具/.test(subject)) {
    return fit.accountFit === "AI先锋"
      ? "流量工具越多，越要先搭自己的内容系统"
      : "平台工具一直在变，但真正稳定的是内容生产能力";
  }
  const trafficTemplates = [
    `${subject}，真正拉开差距的是产能`,
    `普通人做AI最大的误区，不是不会工具，而是没有产能系统`,
    `你以为AI是在省时间，其实它在重做内容生产规则`,
    `AI真正值钱的地方，不是炫技，而是把一个人变成一个团队`
  ];
  const trustTemplates = [
    `${subject}说明了一个更大的变化`,
    `未来真正被AI淘汰的，不是不会写代码的人`,
    `别再只追AI工具了，真正的分水岭是判断力`,
    `${subject}里藏着普通人最容易看错的机会`
  ];
  const conversionTemplates = [
    `如果你还在手动憋口播稿，你已经输给了机器产能`,
    `${subject}可以怎么变成一套内容生产系统`,
    `别再手动硬扛内容了，先把这一步交给AI`,
    `一个人想持续发内容，先别学工具，先搭产能链路`
  ];

  const pick = (items) => items[index % items.length];
  if (fit.accountFit === "AI先锋") {
    return fit.goal === "转化" ? pick(conversionTemplates) : pick(trafficTemplates);
  }
  if (fit.accountFit === "AI先锋者") {
    return pick(trustTemplates);
  }
  if (fit.goal === "转化") return pick(conversionTemplates);
  if (fit.goal === "信任") return pick(trustTemplates);
  return pick(trafficTemplates);
}

function hookLine(item, fit, source) {
  const subject = titleTopic(item, source);
  if (/Codex在Windows/.test(subject)) {
    return `别只看 Codex 支持了什么系统，要看它正在把个人电脑变成一个可调度的AI工作台`;
  }
  if (/AI智能体/.test(subject)) {
    return `这类消息最该拆的不是技术，而是普通人什么时候该把重复工作交给智能体`;
  }
  if (/创作者内容生产/.test(subject)) {
    return `内容行业接下来拼的不是谁更努力，而是谁先把选题、脚本和素材流程系统化`;
  }
  if (/短视频如何提高停留/.test(subject)) {
    return `你的视频没人看完，可能不是表达差，而是开头没有设计注意力路径`;
  }
  if (/Claude Code/.test(subject)) {
    return `不会代码的人也要看懂这件事，因为AI工作流正在从程序员扩散到普通人`;
  }
  if (/Instagram内容工具/.test(subject)) {
    return `平台给你的工具越多，越说明内容生产不能再靠临时灵感`;
  }
  if (fit.goal === "转化") {
    if (fit.accountFit === "AI先锋") {
      return `你每天卡在选题、标题和口播稿，其实不是创意不够，是产能系统没搭起来`;
    }
    return `这条内容不要急着卖产品，先拆出一套方法论，再决定怎么承接`;
  }
  if (fit.goal === "信任") {
    const trustHooks = [
      `很多人看AI只看工具更新，但真正重要的是它改变了哪一类人的工作方式`,
      `这件事最值得拆的不是新闻本身，而是普通人接下来会踩的误区`,
      `如果你还把AI当成效率工具，你可能低估了它对内容行业的重写`,
      `${subject}不是热点，它更像一个行业方向的提前提醒`
    ];
    return trustHooks[titleStyleIndex(item, source) % trustHooks.length];
  }
  const trafficHooks = [
    `同样用AI，有人只是省时间，有人已经开始放大内容产能`,
    `你以为差距在工具，其实差距在谁能更快把内容发出去`,
    `这个变化最适合拆给还在手动做内容的人看`,
    `如果一条内容能帮你少憋半天稿，它就不只是资讯`
  ];
  return trafficHooks[titleStyleIndex(item, source) % trafficHooks.length];
}

function productConnection(text, fit) {
  const isIpAccount = fit.accountFit === "AI先锋者";
  if (/私信|dm|咨询|领取|转化|conversion/i.test(text)) {
    return {
      canSell799: isIpAccount ? "间接" : "直接",
      channel: "私信",
      connection: "如果你也想把选题、标题、口播稿做成稳定流程，可以私信我看 AI口播智能体。",
      noReason: isIpAccount ? "IP号不建议一上来强卖，先用观点建立信任，再承接私信。" : ""
    };
  }
  if (/直播|livestream|live/i.test(text)) {
    return {
      canSell799: isIpAccount ? "间接" : "直接",
      channel: "直播",
      connection: "直播里可以用真实案例演示 AI口播智能体如何把选题、脚本、口播产能串起来。",
      noReason: isIpAccount ? "IP号更适合把直播作为信任延展，不宜直接硬转化。" : ""
    };
  }
  if (/口播|内容生产|creator|video|short video|script|脚本|工具|\btool\b|\bapp\b|应用/i.test(text)) {
    return {
      canSell799: isIpAccount ? "间接" : "直接",
      channel: "教程演示",
      connection: "可以演示从热点到标题、从标题到口播稿，再自然带到 AI口播智能体。",
      noReason: isIpAccount ? "适合先讲方法论，产品只作为案例，不做强销售。" : ""
    };
  }
  if (/case|案例|company|团队|workflow|自动化|智能体|agent/i.test(text)) {
    return {
      canSell799: "间接",
      channel: isIpAccount ? "观点铺垫" : "案例拆解",
      connection: "先拆清楚为什么一个人需要一套内容产能系统，再把 AI口播智能体作为落地工具带出。",
      noReason: isIpAccount ? "这类内容更适合建立认知资产，不适合直接转化。" : ""
    };
  }
  if (isIpAccount) {
    return {
      canSell799: "不承接",
      channel: "暂不承接",
      connection: "",
      noReason: "更适合做行业观察、误区拆解或人设信任，不建议强行连接 799 产品。"
    };
  }
  return {
    canSell799: "不承接",
    channel: "暂不承接",
    connection: "",
    noReason: "暂时无法自然连接内容生产、AI变现或账号定位。"
  };
}

function sentence(value) {
  const text = normalize(value);
  return text ? text.replace(/[。.!！]+$/, "") : "";
}

function riskFlags(item) {
  const text = `${item.title} ${item.summary}`;
  return {
    unverified: /rumor|leak|unconfirmed|传闻|泄露|爆料|未证实/i.test(text),
    regulated: /policy|regulation|lawsuit|法律|监管|诉讼/i.test(text),
    safety: /security|attack|breach|safety|安全|攻击|漏洞/i.test(text),
    weakSummary: !normalize(item.summary)
  };
}

function nextAction(item, fit, relevance, product, risks) {
  if (risks.unverified) return "不做";
  if (risks.regulated || risks.safety || risks.weakSummary) return "人工核验";
  if (relevance.level === "强相关" && product.canSell799 !== "不承接") return "拍短视频";
  if (relevance.level === "强相关" || (relevance.level === "中相关" && fit.goal === "转化")) return "拍短视频";
  if (relevance.level === "中相关") return "放入观察";
  return "不做";
}

function shootingSuggestion(item, source, fit, product) {
  const subject = titleTopic(item, source);
  const pick = (items) => items[titleStyleIndex(item, source) % items.length];
  if (fit.goal === "转化") {
    if (product.channel === "私信") return `用“痛点场景-流程演示-私信领取/咨询”的结构拍，结尾承接想提升口播产能的人。`;
    if (product.channel === "直播") return `用一个真实内容生产案例开场，直播里展开演示 AI口播智能体的完整流程。`;
    if (product.channel === "教程演示") return `直接录屏演示从${subject}到标题、钩子、口播稿的三步流程。`;
    return `先讲${subject}里的提效逻辑，再用案例过渡到内容产能系统。`;
  }
  if (fit.goal === "信任") {
    if (fit.accountFit === "AI先锋者") {
      return pick([
        `从${subject}切入，先给趋势判断，再讲普通人应该调整哪一个行动习惯。`,
        `拍成观点口播，重点讲这件事背后的机会边界和你自己的取舍。`,
        `用“现象-变化-普通人应对”的节奏讲，结尾留一个可讨论的判断。`,
        `把它当成一次行业观察，不讲工具教程，讲它会怎样改变个人工作方式。`
      ]);
    }
    return pick([
      `先讲一个真实内容生产卡点，再拆它如何变成更稳定的选题、脚本和复盘流程。`,
      `用一个小案例证明内容产能为什么需要系统化，结尾自然引到后续教程或私信。`,
      `拍成案例拆解，不急着卖产品，先让用户相信你真的懂内容流程。`,
      `从创作者每天卡住的一步切入，讲清楚工具变化如何落到账号运营结果。`
    ]);
  }
  return pick([
    `用反常识开头，快速讲清它能帮自媒体人省哪一步、提升哪一个指标。`,
    `先抛出一个具体场景，再用 20 秒讲清这个变化为什么值得普通人关注。`,
    `用强标题抓流量，正文只讲一个可落地动作，避免展开成泛泛资讯。`,
    `把热点改成用户痛点表达，重点讲它对选题、停留或发布效率的直接影响。`
  ]);
}

function buildAngle(item, source, fit, relevance) {
  const text = `${item.title} ${item.summary} ${source.category}`;
  const title = shortTitle(item, fit, source);
  const hook = hookLine(item, fit, source);
  const product = productConnection(text, fit);
  const action = nextAction(item, fit, relevance, product, riskFlags(item));
  const suggestion = shootingSuggestion(item, source, fit, product);
  const connection = product.connection ? `产品连接句：${sentence(product.connection)}。` : `不承接原因：${sentence(product.noReason)}。`;
  return `可拍标题：${title}。前3秒：${hook}。适合账号：${fit.accountFit}。内容用途：${fit.goal}。799承接：${product.canSell799}，${product.channel}。${connection}下一步动作：${action}。拍摄建议：${suggestion}`;
}

function riskNote(item, source) {
  const text = `${item.title} ${item.summary}`;
  const risks = [];
  if (/rumor|leak|unconfirmed|传闻|泄露|爆料/i.test(text)) risks.push("疑似传闻或爆料，需核验后再做内容");
  if (/policy|regulation|lawsuit|法律|监管|诉讼|安全/i.test(text)) risks.push("涉及政策/法律/安全，避免直接做强转化");
  if (!normalize(item.summary)) risks.push("摘要不足，建议打开公开链接人工确认");
  return risks.join("；") || `公开来源：${source.source_name}，发布前核对发布时间和上下文。`;
}

function buildAiNewsRow(dateText, source, item, relevance = classifyRelevance(`${item.title} ${item.summary}`, source)) {
  const text = `${item.title} ${item.summary} ${source.category}`;
  const fit = analyzeFit(text, relevance);
  const product = productConnection(text, fit);
  const action = nextAction(item, fit, relevance, product, riskFlags(item));
  const suitable = action === "拍短视频" || action === "放入观察" ? "是" : "否";
  const angle = buildAngle(item, source, fit, relevance);
  return {
    "日期": dateText,
    "来源": source.source_name,
    "标题": item.title || "未识别标题",
    "摘要": item.summary || "公开来源未提供摘要，建议打开链接确认。",
    "链接": item.link || source.url,
    "关键词": extractKeywords(text),
    "相关等级": relevance.level,
    "与AI先锋相关度": fit.xianfeng,
    "与AI先锋者相关度": fit.xianfengzhe,
    "判断原因": `${relevance.reason}；${fit.reason}`,
    "是否适合做内容": suitable,
    "是否值得做成短视频": suitable,
    "建议内容类型": fit.goal,
    "可拍标题": shortTitle(item, fit, source),
    "前3秒钩子": hookLine(item, fit, source),
    "适合账号": fit.accountFit,
    "是否适合承接799元AI口播智能体": product.canSell799,
    "承接方式": product.channel,
    "产品连接句": product.connection,
    "不适合承接原因": product.noReason,
    "下一步动作": action,
    "一句话拍摄建议": shootingSuggestion(item, source, fit, product),
    "建议切入角度": angle,
    "风险备注": riskNote(item, source),
    "失败原因": ""
  };
}

function buildHotMaterialRow(dateText, source, item, relevance = classifyRelevance(`${item.title} ${item.summary}`, source)) {
  const text = `${item.title} ${item.summary} ${source.category}`;
  const fit = analyzeFit(text, relevance);
  const title = shortTitle(item, fit, source);
  const hook = hookLine(item, fit, source);
  const product = productConnection(text, fit);
  const action = nextAction(item, fit, relevance, product, riskFlags(item));
  const notRecommended = action === "不做" ? "明显弱相关或风险较高，暂不适合 AI先锋 / AI先锋者，也无法自然连接内容生产、AI变现或账号定位。" : "";
  const angle = buildAngle(item, source, fit, relevance);
  return {
    "日期": dateText,
    "热点名称": item.title || "未识别热点名称",
    "来源": source.source_name,
    "链接": item.link || source.url,
    "热点类型": source.category,
    "相关等级": relevance.level,
    "热度判断": "公开来源新近更新，需结合平台可见数据人工核验热度",
    "可延展方向": fit.accountFit === "AI先锋者"
      ? "趋势判断、机会判断、误区拆解、行业观察"
      : "工具落地、内容提效、获客转化、案例拆解",
    "可拍视频标题": title,
    "前3秒钩子建议": hook,
    "适合账号": fit.accountFit,
    "内容用途": fit.goal,
    "是否适合承接799元AI口播智能体": product.canSell799,
    "承接方式": product.channel,
    "产品连接句": product.connection,
    "不适合承接原因": product.noReason,
    "下一步动作": action,
    "一句话拍摄建议": shootingSuggestion(item, source, fit, product),
    "适合AI先锋还是AI先锋者": fit.accountFit,
    "适合流量/信任/转化": fit.goal,
    "可做视频角度": angle,
    "不建议做的原因": notRecommended,
    "风险备注": riskNote(item, source),
    "失败原因": ""
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function enabledSources(sources) {
  return (Array.isArray(sources) ? sources : []).filter((source) => source && source.enabled === true && normalize(source.url));
}

async function fetchText(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/rss+xml, application/atom+xml, text/xml, text/html, */*"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function readSource(source) {
  const text = await fetchText(source.url);
  const type = normalize(source.source_type).toLowerCase();
  const items = type === "rss" || text.includes("<rss") || text.includes("<feed")
    ? parseRssItems(text, source.url)
    : parsePublicPage(text, source.url);

  return items
    .filter((item) => normalize(item.title))
    .slice(0, MAX_ITEMS_PER_SOURCE);
}

function sourceHealthRow(dateText, source, success, error = "", keptCount = 0, filteredCount = 0) {
  return {
    "日期": dateText,
    "来源名称": source.source_name || "未命名来源",
    "来源链接": source.url || "",
    "是否读取成功": success ? "是" : "否",
    "失败原因": success ? "" : (error.message || String(error)),
    "是否建议保留": success && keptCount > 0 ? `是，入主表 ${keptCount} 条，过滤弱相关 ${filteredCount} 条` : success ? `观察，过滤弱相关 ${filteredCount} 条` : "否",
    "是否需要我人工处理": success ? (keptCount > 0 ? "否" : "可人工检查来源是否太泛或补充更垂直来源") : "是，检查公开链接是否仍可访问或更换来源"
  };
}

async function collectRows(dateText, sources, buildRow) {
  const rows = [];
  const healthRows = [];

  for (const source of enabledSources(sources)) {
    try {
      const items = await readSource(source);
      if (!items.length) {
        throw new Error("公开来源可访问，但未识别到可用条目");
      }
      let keptCount = 0;
      let filteredCount = 0;
      for (const item of items) {
        const text = `${item.title} ${item.summary}`;
        const relevance = classifyRelevance(text, source);
        if (isStrongOrMedium(relevance)) {
          rows.push(buildRow(dateText, source, item, relevance));
          keptCount += 1;
        } else {
          filteredCount += 1;
        }
      }
      healthRows.push(sourceHealthRow(dateText, source, true, "", keptCount, filteredCount));
    } catch (error) {
      healthRows.push(sourceHealthRow(dateText, source, false, error, 0));
    }
  }

  return { rows, healthRows };
}

function listLines(items, formatter) {
  if (!items.length) return "- 暂无";
  return items.slice(0, 12).map(formatter).join("\n");
}

function isActionable(row) {
  return row["下一步动作"] === "拍短视频" || row["下一步动作"] === "放入观察";
}

function briefTitle(row) {
  return row["可拍标题"] || row["可拍视频标题"] || row["标题"] || row["热点名称"];
}

function briefHook(row) {
  return row["前3秒钩子"] || row["前3秒钩子建议"] || "待人工补充前3秒钩子";
}

function briefFit(row) {
  return row["适合账号"] || row["适合AI先锋还是AI先锋者"] || "待判断";
}

function briefGoal(row) {
  return row["建议内容类型"] || row["内容用途"] || row["适合流量/信任/转化"] || "观察";
}

function briefProduct(row) {
  return row["是否适合承接799元AI口播智能体"] || "待判断";
}

function briefConnection(row) {
  return row["产品连接句"] || row["不适合承接原因"] || "待人工判断承接方式";
}

function briefSuggestion(row) {
  return row["一句话拍摄建议"] || "用标题、钩子、判断、下一步动作四段式拍成短视频。";
}

function accountFits(row, accountName) {
  const fit = briefFit(row);
  return fit === accountName || fit === "两个都适合";
}

function briefLine(row) {
  return `- 可拍标题：${briefTitle(row)}｜前3秒：${briefHook(row)}｜适合：${briefFit(row)}｜用途：${briefGoal(row)}｜799承接：${briefProduct(row)}｜承接方式：${row["承接方式"] || "暂不承接"}｜${sentence(briefConnection(row))}｜下一步：${row["下一步动作"] || "放入观察"}｜拍摄建议：${briefSuggestion(row)}`;
}

function trustFallbackLine() {
  return "- 今日信任型候选不足 3 条，原因：当前公开来源更偏工具更新和运营方法，缺少足够行业判断、误区拆解、长期人设信任类材料。建议补充更垂直的 AI商业观察、创作者经济、知识付费方法论公开来源。";
}

function rawTitle(row) {
  return normalize(row["标题"] || row["热点名称"] || briefTitle(row));
}

function rowTopic(row) {
  const title = rawTitle(row).toLowerCase();
  if (/codex/.test(title) && /windows|sandbox/.test(title)) return "把AI工具变成本地工作流";
  if (/agent|ai-assisted|智能体/.test(title)) return "AI智能体进入真实工作";
  if (/creator|creative|content|video|short-form|youtube|instagram|创作者|短视频/.test(title)) return "内容生产正在系统化";
  if (/claude code/.test(title)) return "普通人开始调度AI工作流";
  if (/gemini/.test(title)) return "AI工具从聊天走向生产";
  return briefTitle(row).replace(/^可拍标题：/, "");
}

function pickCandidate(rows, preferred, used = new Set()) {
  const pool = rows.filter((row) => !used.has(rawTitle(row)));
  const matched = pool.find(preferred) || pool[0] || rows.find(preferred) || rows[0] || null;
  if (matched) used.add(rawTitle(matched));
  return matched;
}

function fallbackRow(label) {
  return {
    "标题": label,
    "可拍标题": label,
    "前3秒钩子": "当前公开来源不足，需要补充更垂直的信息源后再细化。",
    "适合账号": "两个都适合",
    "建议内容类型": "信任",
    "是否适合承接799元AI口播智能体": "不承接",
    "承接方式": "暂不承接",
    "不适合承接原因": "素材不足，先不做产品承接。",
    "下一步动作": "放入观察",
    "一句话拍摄建议": "先作为占位选题，等公开来源或人工素材补齐后再拍。"
  };
}

function xianfengPackageItem(kind, row) {
  const topic = rowTopic(row);
  const templates = {
    traffic: {
      title: `如果你还在手动憋口播稿，你已经输给了机器产能`,
      hook: `同样一个AI热点，别人只能发一条，你要学的是把它拆成一套可重复生产的内容流程。`,
      form: "露脸口播 + 录屏演示",
      product: "间接",
      channel: "教程演示",
      cta: "想看我怎么把一个热点拆成标题、钩子和口播稿，可以评论或私信“口播”。"
    },
    trust: {
      title: `${topic}：内容能力正在变成系统能力`,
      hook: `很多人以为做内容靠灵感，真正稳定的账号靠的是选题、脚本、口播和复盘流程。`,
      form: "露脸口播 + 案例拆解",
      product: "间接",
      channel: "案例拆解",
      cta: "如果你也想搭自己的内容产能流程，先从一条口播稿的标准化开始。"
    },
    conversion: {
      title: `普通人做AI内容，先别追工具，先把口播产能跑通`,
      hook: `你每天最浪费时间的不是拍摄，而是开拍前的选题、标题和口播稿。`,
      form: "录屏教程 + 直播/私信承接",
      product: "直接",
      channel: "私信 / 直播 / 教程演示",
      cta: "想要一套从选题到口播稿的流程，可以私信我看 799 元 AI口播智能体。"
    }
  };
  return { ...templates[kind], source: rawTitle(row) };
}

function formatXianfengPackageItem(label, item) {
  return `### ${label}

- 标题：${item.title}
- 前3秒：${item.hook}
- 拍摄形式：${item.form}
- 是否承接799产品：${item.product}
- 私信/直播/教程/案例承接方式：${item.channel}
- 结尾CTA：${item.cta}
- 来源线索：${item.source}`;
}

function xianfengzhePackageItem(kind, row) {
  const topic = rowTopic(row);
  const templates = {
    trafficCognition: {
      title: `${topic}，真正提醒普通人的是：AI机会不在工具本身`,
      hook: `普通人入局AI，最危险的不是不会工具，而是把每一次变化都当成热闹看。`,
      point: `AI的机会不在“又出了什么工具”，而在谁能把工具变化翻译成自己的生产力和判断力。`,
      why: "它能输出认知判断，不急着卖产品，适合建立 AI先锋者 的观点辨识度。",
      style: "高认知、判断感强、带一点反常识",
      form: "露脸观点口播",
      product: "默认不强提产品",
      role: "用于建立“我能看懂AI变化背后的真实机会”的长期认知标签。"
    },
    trustMethodology: {
      title: `AI真正值钱的地方，不是炫技，而是把一个人变成一个团队`,
      hook: `如果你只把AI当工具，你看到的是省时间；如果你把AI当系统，你看到的是产能重构。`,
      point: `长期能赢的人，不是工具收藏最多的人，而是最早把选题、脚本、运营和复盘系统化的人。`,
      why: "它沉淀方法论，能增强信任，不把 AI先锋者 变成短期卖货号。",
      style: "方法论拆解、稳、强判断",
      form: "露脸口播 + 白板/大纲",
      product: "不强提产品，可自然提“我自己的实战系统”",
      role: "用于沉淀“懂方法、懂运营、懂长期复利”的IP信任。"
    },
    persona: {
      title: `我越来越确定：普通人做AI，不能只学工具，要练判断`,
      hook: `这段时间我看了很多AI项目，真正有价值的不是最热的，而是能持续带来结果的。`,
      point: `AI先锋者 要持续记录自己的判断、试错和复盘，让用户相信你不是搬运资讯，而是在真实实践。`,
      why: "它强化个人实战记录和长期人设，不依赖短期转化。",
      style: "个人复盘、实战感、克制但锋利",
      form: "露脸口播 / 日更复盘",
      product: "不提产品",
      role: "用于建立长期人设资产，为未来高客单咨询、陪跑、课程和合作铺垫。"
    }
  };
  return { ...templates[kind], source: rawTitle(row) };
}

function formatXianfengzhePackageItem(label, item) {
  return `### ${label}

- 标题：${item.title}
- 前3秒：${item.hook}
- 核心观点：${item.point}
- 为什么适合AI先锋者：${item.why}
- 适合的表达风格：${item.style}
- 拍摄形式：${item.form}
- 是否需要提产品：${item.product}
- 这条内容在长期IP建设里的作用：${item.role}
- 来源线索：${item.source}`;
}

function buildAccountPackages(rows) {
  const usedXianfeng = new Set();
  const usedXianfengzhe = new Set();
  const safeRows = rows.length ? rows : [fallbackRow("公开信息源候选不足")];
  const xianfengTraffic = pickCandidate(safeRows, (row) => /短视频|YouTube|Instagram|内容|流量|attention|traffic/i.test(rawTitle(row)), usedXianfeng) || fallbackRow("AI先锋流量候选不足");
  const xianfengTrust = pickCandidate(safeRows, (row) => /案例|系统|workflow|Codex|Claude|Gemini|工具|方法/i.test(rawTitle(row)), usedXianfeng) || fallbackRow("AI先锋信任候选不足");
  const xianfengConversion = pickCandidate(safeRows, (row) => /口播|内容|creator|video|script|workflow|智能体|agent|tool|工具/i.test(`${rawTitle(row)} ${row["关键词"] || ""}`), usedXianfeng) || fallbackRow("AI先锋转化候选不足");

  const xianfengzheTraffic = pickCandidate(safeRows, (row) => /AI|Gemini|Codex|Claude|智能体|agent|机会|趋势/i.test(rawTitle(row)), usedXianfengzhe) || fallbackRow("AI先锋者流量型认知候选不足");
  const xianfengzheTrust = pickCandidate(safeRows, (row) => /workflow|系统|方法|工具|Code|内容|attention|生产/i.test(rawTitle(row)), usedXianfengzhe) || fallbackRow("AI先锋者信任方法论候选不足");
  const xianfengzhePersona = pickCandidate(safeRows, (row) => /creator|创作者|startup|AI|工具|内容|Gemini/i.test(rawTitle(row)), usedXianfengzhe) || fallbackRow("AI先锋者长期人设候选不足");

  return {
    xianfeng: [
      ["流量内容", xianfengPackageItem("traffic", xianfengTraffic)],
      ["信任内容", xianfengPackageItem("trust", xianfengTrust)],
      ["转化内容", xianfengPackageItem("conversion", xianfengConversion)]
    ],
    xianfengzhe: [
      ["流量型认知内容", xianfengzhePackageItem("trafficCognition", xianfengzheTraffic)],
      ["信任型方法论内容", xianfengzhePackageItem("trustMethodology", xianfengzheTrust)],
      ["长期人设内容", xianfengzhePackageItem("persona", xianfengzhePersona)]
    ]
  };
}

function uniqueBriefRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = normalize(briefTitle(row) || rawTitle(row) || row["链接"]).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueFailureRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = normalize(row["来源链接"] || `${row["来源名称"]}-${row["失败原因"]}`).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolvedBriefAccount(row) {
  const fit = briefFit(row);
  if (fit === "AI先锋" || fit === "AI先锋者") return fit;

  const text = `${rawTitle(row)} ${briefTitle(row)} ${briefHook(row)} ${row["摘要"] || ""} ${row["关键词"] || ""}`.toLowerCase();
  const product = briefProduct(row);
  const goal = briefGoal(row);
  const conversionCue = goal === "转化" || /直接|间接/.test(product);
  const xianfengCue = /口播|脚本|短视频|内容|私信|直播|教程|案例|获客|转化|creator|video|script|workflow/.test(text);
  const xianfengzheCue = /认知|趋势|判断|误区|行业|未来|机会|模型|智能体|agent|model|codex|claude|gemini/.test(text);

  if (conversionCue && xianfengCue) return "AI先锋";
  if (xianfengzheCue || goal === "信任") return "AI先锋者";
  return "AI先锋";
}

function resolvedBriefGoal(row) {
  const goal = briefGoal(row);
  if (goal === "流量" || goal === "信任" || goal === "转化") return goal;
  if (/直接/.test(briefProduct(row))) return "转化";
  return resolvedBriefAccount(row) === "AI先锋者" ? "信任" : "流量";
}

function sourceSummaryPurpose(row, account) {
  const text = `${rawTitle(row)} ${briefTitle(row)} ${briefHook(row)} ${row["摘要"] || ""}`.toLowerCase();
  if (account === "AI先锋") {
    if (/直接|转化|私信|直播|799/.test(`${briefProduct(row)} ${briefGoal(row)} ${row["承接方式"] || ""}`)) return "转化";
    if (/youtube|instagram|短视频|attention|traffic|流量/.test(text)) return "流量/信任";
    return "信任";
  }
  if (/人设|个人|复盘|实战/.test(text)) return "长期信任/人设";
  if (/趋势|机会|认知|判断|智能体|agent|codex|claude|gemini|model|模型/.test(text)) return "流量型认知";
  return "长期信任/方法论";
}

function sourceVersionAngle(row, account) {
  const topic = rowTopic(row);
  const text = `${rawTitle(row)} ${briefTitle(row)} ${briefHook(row)} ${row["摘要"] || ""}`.toLowerCase();
  if (account === "AI先锋") {
    if (/youtube|instagram|短视频|attention|traffic/.test(text)) {
      return `改写成内容增长案例：围绕「${topic}」解释如何提高标题、开头和口播产能，并保留私信/教程承接口。`;
    }
    if (/口播|脚本|内容|creator|workflow|工具|tool|agent|智能体/.test(text)) {
      return `改写成工具落地案例：围绕「${topic}」讲一个人如何接进选题、脚本、口播和复盘流程。`;
    }
    return `改写成变现号角度：从用户卡点切入，落到内容生产提效、私信咨询或直播承接。`;
  }
  if (/codex|claude|gemini|agent|智能体|workflow|模型|model/.test(text)) {
    return `改写成认知判断：用「${topic}」说明普通人要从追工具转向重构自己的工作方式。`;
  }
  if (/creator|content|video|短视频|instagram|youtube/.test(text)) {
    return `改写成长期方法论：用「${topic}」讨论创作者为什么要从灵感驱动转向系统驱动。`;
  }
  return `改写成IP观点：围绕「${topic}」输出趋势洞察、机会边界和个人实战判断。`;
}

function sourceSummaryLine(row) {
  const source = row["来源"] || row["热点来源"] || row["来源/入口"] || "公开来源";
  const title = rawTitle(row);
  const level = row["相关等级"] || "待判断";
  const nextActionText = row["下一步动作"] || "放入观察";
  const lineForAccount = (account) =>
    `- ${source}｜${title}｜相关等级：${level}｜${account}版本角度：${sourceVersionAngle(row, account)}｜内容目的：${sourceSummaryPurpose(row, account)}｜下一步：${nextActionText}`;

  if (briefFit(row) === "两个都适合") {
    return [lineForAccount("AI先锋"), lineForAccount("AI先锋者")].join("\n");
  }

  const account = resolvedBriefAccount(row);
  return lineForAccount(account);
}

function packageItemByLabel(items, label) {
  const found = items.find(([itemLabel]) => itemLabel === label);
  return found ? found[1] : null;
}

function buildShootingDecisions(accountPackages) {
  return [
    {
      account: "AI先锋",
      purpose: "流量/信任优先",
      item: packageItemByLabel(accountPackages.xianfeng, "流量内容") || packageItemByLabel(accountPackages.xianfeng, "信任内容"),
      ending: "评论或私信“口播”，承接到口播稿拆解和教程演示。",
      product: "轻提产品，优先先建立流量和信任。",
      why: "今天的信息源更容易落到内容产能、选题和口播流程，适合先拿精准流量和信任。",
      difficulty: "低到中：露脸口播即可，录屏只需要展示一个流程片段。",
      value: "带来精准流量、评论互动和后续私信入口。"
    },
    {
      account: "AI先锋",
      purpose: "转化优先",
      item: packageItemByLabel(accountPackages.xianfeng, "转化内容"),
      ending: "明确引导私信或直播间了解 799 元 AI口播智能体。",
      product: "明确提 799 元 AI口播智能体。",
      why: "用户痛点集中在选题、标题和口播稿产能，今天适合把痛点直接接到产品解决方案。",
      difficulty: "中：需要录屏演示一小段从选题到口播稿的流程。",
      value: "更适合带来私信咨询、直播间承接和产品意向。"
    },
    {
      account: "AI先锋者",
      purpose: "流量型认知优先",
      item: packageItemByLabel(accountPackages.xianfengzhe, "流量型认知内容"),
      ending: "用一句趋势判断收束，引导用户评论自己的判断。",
      product: "不强提产品。",
      why: "今天的公开线索适合做趋势判断和误区拆解，能强化 AI先锋者 的认知辨识度。",
      difficulty: "低：以露脸观点口播为主，不需要复杂素材。",
      value: "提升关注理由、评论质量和账号观点标签。"
    },
    {
      account: "AI先锋者",
      purpose: "长期信任/人设优先",
      item: packageItemByLabel(accountPackages.xianfengzhe, "长期人设内容"),
      ending: "以个人实战记录收尾，说明后续会继续复盘真实判断和结果。",
      product: "不提产品。",
      why: "AI先锋者 需要持续积累个人判断、实战感和长期信任，这条不依赖热点也能沉淀资产。",
      difficulty: "低：用日更复盘口吻拍，重点讲自己的判断和取舍。",
      value: "沉淀长期人设，为后续咨询、陪跑、课程和合作建立信任底座。"
    }
  ];
}

function formatShootingDecision(decision, index) {
  const item = decision.item || fallbackRow(`${decision.account}${decision.purpose}候选不足`);
  return `### ${index + 1}. ${decision.account}｜${decision.purpose}

- 标题：${item.title || briefTitle(item)}
- 前3秒：${item.hook || briefHook(item)}
- 账号：${decision.account}
- 内容目的：${decision.purpose}
- 拍摄形式：${item.form || "露脸口播"}
- 结尾方式：${item.cta || decision.ending}
- 是否提产品：${decision.product}
- 为什么今天优先拍：${decision.why}
- 拍摄难度：${decision.difficulty}
- 预计价值：${decision.value}`;
}

function riskyLine(row) {
  return `- ${rawTitle(row)}：${row["不建议做的原因"] || row["风险备注"] || "相关度、风险或承接链路不足，今日不优先做。"}`;
}

function fileWriteWarningLines(fileWriteWarnings) {
  if (!fileWriteWarnings.length) return "";
  return `\n- 文件写入提示：${fileWriteWarnings.map((item) => `${item.targetPath} 改写到 ${item.writtenPath}`).join("；")}`;
}

function buildDailyBrief(dateText, aiRows, hotRows, failures, fileWriteWarnings = []) {
  const validAi = aiRows.filter(isActionable);
  const validHot = hotRows.filter(isActionable);
  const combinedRows = [...validAi, ...validHot];
  const accountPackages = buildAccountPackages(combinedRows);
  const shootingDecisions = buildShootingDecisions(accountPackages);
  const sourceSummaryRows = uniqueBriefRows(combinedRows);
  const riskyRows = uniqueBriefRows([...aiRows, ...hotRows].filter((row) => row["下一步动作"] === "不做" || Boolean(row["不建议做的原因"])));
  const failureRows = uniqueFailureRows(failures);

  return `# 每日AI简报 ${dateText}

## 一、AI先锋 今日变现内容包

${accountPackages.xianfeng.map(([label, item]) => formatXianfengPackageItem(label, item)).join("\n\n")}

## 二、AI先锋者 今日IP内容包

${accountPackages.xianfengzhe.map(([label, item]) => formatXianfengzhePackageItem(label, item)).join("\n\n")}

## 三、今天最建议拍的4条

${shootingDecisions.map(formatShootingDecision).join("\n\n")}

## 四、今日信息源摘要

${listLines(sourceSummaryRows, sourceSummaryLine)}

## 五、今日不建议做的内容

${listLines(riskyRows, riskyLine)}

## 六、今日读取失败的信息源

${listLines(failureRows, (item) => `- ${item["来源名称"]}：${item["失败原因"]}（${item["来源链接"]}）`)}

## 七、明天建议观察什么

- 继续观察公开 AI 产品/工具/模型更新是否能转成普通人可落地的内容生产、提效获客或直播承接选题。
- 继续观察哪些公开热点适合 AI先锋 做转化型案例，哪些适合 AI先锋者 做趋势判断。
- 对读取失败的信息源，检查公开链接是否仍可访问，必要时更换来源或手动补充。

## 八、合规边界

- 本次只读取配置文件中 enabled=true 的公开来源。
- 不访问需要登录的平台页面。
- 不处理验证码，不绕过平台安全机制。
- 读取失败只记录原因，不重试异常请求。${fileWriteWarningLines(fileWriteWarnings)}
`;
}

function learningLines(items, formatter) {
  if (!items.length) return "- 暂无";
  return items.map(formatter).join("\n");
}

function learningSourceLine(row) {
  const name = row["来源名称"] || "未命名来源";
  const link = row["来源链接"] || "无链接";
  const status = row["是否读取成功"] || "待判断";
  const keep = row["是否建议保留"] || "待判断";
  return `- ${name}：${status}；${keep}；${link}`;
}

function learningFailureLine(row) {
  const name = row["来源名称"] || "未命名来源";
  const reason = row["失败原因"] || "未记录失败原因";
  const link = row["来源链接"] || "无链接";
  return `- ${name}：${reason}；${link}`;
}

function learningItemTitle(item) {
  return item.title || briefTitle(item) || rawTitle(item) || "未命名选题";
}

function learningPackageLine([label, item]) {
  return `- ${label}：${learningItemTitle(item)}（来源线索：${item.source || "公开信息源候选"}）`;
}

function learningDecisionLine(decision, index) {
  const item = decision.item || fallbackRow(`${decision.account}${decision.purpose}候选不足`);
  return `- ${index + 1}. ${decision.account}｜${decision.purpose}：${learningItemTitle(item)}`;
}

function abandonedReason(row) {
  return row["不建议做的原因"]
    || row["风险备注"]
    || row["不适合承接原因"]
    || row["失败原因"]
    || "未进入推荐区，需人工复核相关性、风险或账号适配度";
}

function abandonedTopicLine(row) {
  const action = row["下一步动作"] || "未记录动作";
  return `- ${briefTitle(row) || rawTitle(row)}：${action}；${abandonedReason(row)}`;
}

function buildDailyLearningLog(dateText, aiRows, hotRows, sourceHealthRows) {
  const allRows = [...aiRows, ...hotRows];
  const actionableRows = [...aiRows.filter(isActionable), ...hotRows.filter(isActionable)];
  const accountPackages = buildAccountPackages(actionableRows);
  const shootingDecisions = buildShootingDecisions(accountPackages);
  const collectedSources = sourceHealthRows;
  const effectiveSources = sourceHealthRows.filter((row) =>
    row["是否读取成功"] === "是" && /^是/.test(row["是否建议保留"] || "")
  );
  const failedSources = sourceHealthRows.filter((row) => row["是否读取成功"] === "否");
  const abandonedRows = uniqueBriefRows(allRows.filter((row) => !isActionable(row)));

  return `# 每日学习记录 daily_learning_log ${dateText}

## 一、日期

${dateText}

## 二、今日采集信息源

${learningLines(collectedSources, learningSourceLine)}

## 三、有效信息源

${learningLines(effectiveSources, learningSourceLine)}

## 四、失败信息源

${learningLines(failedSources, learningFailureLine)}

## 五、进入 AI先锋 内容包的选题

${learningLines(accountPackages.xianfeng, learningPackageLine)}

## 六、进入 AI先锋者 内容包的选题

${learningLines(accountPackages.xianfengzhe, learningPackageLine)}

## 七、进入今天最建议拍的4条的选题

${learningLines(shootingDecisions, learningDecisionLine)}

## 八、被放弃的选题

${learningLines(abandonedRows, abandonedTopicLine)}

## 九、放弃原因

${learningLines(abandonedRows, (row) => `- ${briefTitle(row) || rawTitle(row)}：${abandonedReason(row)}`)}

## 十、今日推荐判断依据

- 优先使用已成功读取、且进入主表的公开信息源。
- 优先选择与 AI内容生产、AI提效、自媒体运营、知识付费、个体创业者提效、私信转化或直播承接强相关的素材。
- AI先锋 优先判断是否能形成流量、信任、转化、私信、直播或 799 元 AI口播智能体承接。
- AI先锋者 优先判断是否能形成高认知、趋势判断、行业误区拆解、个人实战记录、长期信任或方法论沉淀。
- 不确定真实性、时效性、风险边界或账号适配度的选题，不进入优先拍摄建议。

## 十一、AI先锋 今日学习到什么

${learningLines(accountPackages.xianfeng, learningPackageLine)}
- 今日学习重点：继续把热点素材转成流量、信任、转化、私信、直播和 799 元 AI口播智能体承接的可执行内容，但不把弱相关素材硬接产品。

## 十二、AI先锋者 今日学习到什么

${learningLines(accountPackages.xianfengzhe, learningPackageLine)}
- 今日学习重点：继续沉淀高认知、趋势判断、行业误区、个人实战、长期信任和方法论，不把 AI先锋者 带偏成卖货号。

## 十三、用户人工反馈入口

| 哪条内容发了 | 播放量 | 点赞 | 评论 | 收藏 | 私信数 | 直播转化情况 | 成交情况 | 用户主观判断：有效 / 一般 / 不适合 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 待补充 | 待补充 | 待补充 | 待补充 | 待补充 | 待补充 | 待补充 | 待补充 | 待补充 | 待补充 |

## 十四、双账号学习边界

- AI先锋 学习重点是流量、信任、转化、私信、直播、799 元 AI口播智能体承接。
- AI先锋者 学习重点是高认知、趋势判断、行业误区、个人实战、长期信任、方法论沉淀。
- AI先锋者 不能被学习机制带偏成卖货号。
- 不能让所有学习结论都导向 799 产品。
`;
}

async function checkWritable(filePath) {
  try {
    const handle = await fs.open(filePath, "r+");
    await handle.close();
    return { writable: true, reason: "" };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { writable: true, reason: "" };
    }
    if (error.code === "EBUSY" || error.code === "EPERM" || error.code === "EACCES") {
      return { writable: false, reason: error.message || error.code };
    }
    throw error;
  }
}

async function nextFallbackCsvPath(filePath) {
  const parsed = path.parse(filePath);
  for (let index = 2; index <= 50; index += 1) {
    const fallbackPath = path.join(parsed.dir, `${parsed.name}_v${index}${parsed.ext}`);
    try {
      await fs.access(fallbackPath);
    } catch (error) {
      if (error.code === "ENOENT") return fallbackPath;
      throw error;
    }
  }
  const now = new Date();
  const stamp = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return path.join(parsed.dir, `${parsed.name}_${stamp}${parsed.ext}`);
}

async function writeCsv(filePath, headers, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = serializeRows(headers, rows);
  const writeResult = {
    targetPath: filePath,
    writtenPath: filePath,
    usedFallback: false,
    reason: ""
  };

  const writable = await checkWritable(filePath);
  if (!writable.writable) {
    const fallbackPath = await nextFallbackCsvPath(filePath);
    await fs.writeFile(fallbackPath, content, "utf8");
    return {
      ...writeResult,
      writtenPath: fallbackPath,
      usedFallback: true,
      reason: `原目标文件被占用：${writable.reason}`
    };
  }

  try {
    await fs.writeFile(filePath, content, "utf8");
    return writeResult;
  } catch (error) {
    if (error.code !== "EBUSY" && error.code !== "EPERM" && error.code !== "EACCES") throw error;
    const fallbackPath = await nextFallbackCsvPath(filePath);
    await fs.writeFile(fallbackPath, content, "utf8");
    return {
      ...writeResult,
      writtenPath: fallbackPath,
      usedFallback: true,
      reason: `写入时发现原目标文件被占用：${error.message || error.code}`
    };
  }
}

async function collectDailyPublicSources(options = {}) {
  const root = options.root || process.cwd();
  const dateText = options.dateText || todayString();
  const sourceDir = options.sourceDir || path.join(root, "data", "sources");
  const dailyDir = options.dailyDir || path.join(root, "data", "daily");
  const outputDir = options.outputDir || path.join(root, "outputs");
  const aiSourcePath = path.join(sourceDir, "public_ai_sources.json");
  const hotSourcePath = path.join(sourceDir, "public_hot_material_sources.json");
  const aiSources = await readJson(aiSourcePath, []);
  const hotSources = await readJson(hotSourcePath, []);

  const aiResult = await collectRows(dateText, aiSources, buildAiNewsRow);
  const hotResult = await collectRows(dateText, hotSources, buildHotMaterialRow);
  const sourceHealthRows = [...aiResult.healthRows, ...hotResult.healthRows];
  const failures = sourceHealthRows.filter((row) => row["是否读取成功"] === "否");
  const aiNewsPath = path.join(dailyDir, `ai_news_${dateText}.csv`);
  const hotMaterialsPath = path.join(dailyDir, `hot_materials_${dateText}.csv`);
  const sourceHealthPath = path.join(dailyDir, `source_health_${dateText}.csv`);
  const briefPath = path.join(outputDir, `ai_daily_brief_${dateText}.md`);
  const learningDir = path.join(outputDir, "learning");
  const learningLogPath = path.join(learningDir, `daily_learning_log_${dateText}.md`);

  const writtenAiNews = await writeCsv(aiNewsPath, AI_NEWS_HEADERS, aiResult.rows);
  const writtenHotMaterials = await writeCsv(hotMaterialsPath, HOT_MATERIAL_HEADERS, hotResult.rows);
  const writtenSourceHealth = await writeCsv(sourceHealthPath, SOURCE_HEALTH_HEADERS, sourceHealthRows);
  const fileWriteWarnings = [writtenAiNews, writtenHotMaterials, writtenSourceHealth]
    .filter((item) => item.usedFallback)
    .map((item) => ({
      targetPath: path.relative(root, item.targetPath).replace(/\\/g, "/"),
      writtenPath: path.relative(root, item.writtenPath).replace(/\\/g, "/"),
      reason: item.reason
    }));
  const brief = buildDailyBrief(dateText, aiResult.rows, hotResult.rows, failures, fileWriteWarnings);
  const learningLog = buildDailyLearningLog(dateText, aiResult.rows, hotResult.rows, sourceHealthRows);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(briefPath, brief, "utf8");
  await fs.mkdir(learningDir, { recursive: true });
  await fs.writeFile(learningLogPath, learningLog, "utf8");

  return {
    date: dateText,
    aiNewsPath: writtenAiNews.writtenPath,
    hotMaterialsPath: writtenHotMaterials.writtenPath,
    sourceHealthPath: writtenSourceHealth.writtenPath,
    briefPath,
    learningLogPath,
    aiRows: aiResult.rows,
    hotRows: hotResult.rows,
    sourceHealthRows,
    failures,
    fileWriteWarnings,
    brief,
    learningLog
  };
}

module.exports = {
  AI_NEWS_HEADERS,
  HOT_MATERIAL_HEADERS,
  SOURCE_HEALTH_HEADERS,
  collectDailyPublicSources,
  parseRssItems,
  parsePublicPage,
  buildDailyBrief
};
