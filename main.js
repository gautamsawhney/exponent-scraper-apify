import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset, sleep } from 'crawlee';

const BASE = 'https://www.tryexponent.com';
const INDEX = `${BASE}/questions`;

function normalizeDateToDDMMYYYY(raw) {
  if (!raw) return '';
  const tryParsers = [
    (s) => new Date(s),
    (s) => {
      const m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
      if (!m) return null;
      return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    },
  ];
  for (const p of tryParsers) {
    try {
      const d = p(raw);
      if (d && !isNaN(d.getTime())) {
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = d.getUTCFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }
    } catch {}
  }
  const m2 = raw.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i);
  if (m2) return normalizeDateToDDMMYYYY(m2[0]);
  return '';
}

function clean(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean).map((s) => s.trim()))];
}

function parseQuestionCard($, questionElement) {
  const questionText = clean(
    $(questionElement).find('h3, h4, [class*="title"], [class*="question"]').first().text() ||
    $(questionElement).find('a').first().text()
  );

  const tags = uniq([
    ...$(questionElement).find('[class*="tag"], [class*="category"], [class*="topic"]').map((_, el) => $(el).text()).get(),
    ...$(questionElement).find('a[href*="type"], a[href*="category"]').map((_, el) => $(el).text()).get()
  ]).join(', ');

  const companySources = [
    ...$(questionElement).find('a[href*="?company="]').map((_, el) => $(el).text()).get(),
    ...$(questionElement).find('[class*="company"], [class*="badge"][class*="company"]').map((_, el) => $(el).text()).get(),
    ...$(questionElement).text().match(/\b(Google|Facebook|Meta|Amazon|Apple|Microsoft|Netflix|Uber|Airbnb|Twitter|LinkedIn|Salesforce|Adobe|Oracle|IBM|Intel|NVIDIA|AMD|Tesla|SpaceX|Stripe|Square|Palantir|Databricks|Snowflake|MongoDB|Atlassian|Slack|Zoom|Discord|TikTok|ByteDance|Alibaba|Tencent|Baidu)\b/gi) || []
  ];
  
  const companyNames = uniq(companySources.filter(c => c.length > 1 && c.length < 100)).join(', ');

  let answerCount = 0;
  const answerText = $(questionElement).text();
  const matches = [...answerText.matchAll(/\b(\d+)\s+answers?\b/gi)];
  if (matches.length) {
    answerCount = Math.max(...matches.map((m) => parseInt(m[1], 10)));
  } else {
    const answerIndicators = $(questionElement).find('[class*="answer"], [class*="response"], [class*="reply"]').length;
    answerCount = answerIndicators || 0;
  }

  let askedWhen = '';
  const timeElement = $(questionElement).find('time').first();
  if (timeElement.length) {
    askedWhen = normalizeDateToDDMMYYYY(timeElement.attr('datetime') || timeElement.text());
  }
  
  if (!askedWhen) {
    const datePatterns = [
      /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+20\d{2}\b/i,
      /\b\d{1,2}\/(\d{1,2})\/\d{4}\b/,
      /\b\d{4}-\d{2}-\d{2}\b/
    ];
    for (const pattern of datePatterns) {
      const match = $(questionElement).text().match(pattern);
      if (match) {
        askedWhen = normalizeDateToDDMMYYYY(match[0]);
        break;
      }
    }
  }

  const questionLink = $(questionElement).find('a[href^="/questions/"]').first().attr('href');
  const showPageLink = questionLink ? new URL(questionLink, BASE).toString() : '';

  return {
    questionText,
    companyNames,
    askedWhen,
    tags,
    answerCount,
    showPageLink
  };
}

function tryParseNextData($) {
  try {
    const script = $('script#__NEXT_DATA__').first();
    if (!script.length) return null;
    const json = script.html() || script.text();
    if (!json) return null;
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function toSlugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    // Expect /questions/<id-or-slug>/...
    return parts.length >= 2 ? parts[1] : parts[parts.length - 1];
  } catch {
    return '';
  }
}

function collectQuestionsFromNextData(nextData) {
  const results = new Map();

  function visit(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === 'object') {
      // Heuristic: question-like objects may contain slug/id and title, tags, answers count
      const keys = Object.keys(node);
      const hasSlug = 'slug' in node || 'id' in node || 'questionId' in node;
      const hasTitle = 'title' in node || 'question' in node || 'name' in node;
      const hasPath = typeof node.href === 'string' && node.href.startsWith('/questions/');
      if ((hasSlug || hasPath) && hasTitle) {
        const href = node.href || (typeof node.slug === 'string' ? `/questions/${node.slug}` : undefined);
        if (href && href.startsWith('/questions/')) {
          const fullUrl = new URL(href, BASE).toString();
          const slug = toSlugFromUrl(fullUrl);
          const entry = results.get(slug) || { showPageLink: fullUrl };
          entry.questionText = entry.questionText || String(node.title || node.question || node.name || '').trim();
          const tagsArr = [];
          if (Array.isArray(node.tags)) tagsArr.push(...node.tags);
          if (Array.isArray(node.categories)) tagsArr.push(...node.categories);
          if (Array.isArray(node.topics)) tagsArr.push(...node.topics);
          entry.tags = uniq([...(entry.tags ? entry.tags.split(',') : []), ...tagsArr]).join(', ');
          const companies = [];
          if (Array.isArray(node.companies)) companies.push(...node.companies.map(String));
          if (typeof node.company === 'string') companies.push(node.company);
          entry.companyNames = uniq([...(entry.companyNames ? entry.companyNames.split(',') : []), ...companies]).join(', ');
          const ac = Number(node.answersCount ?? node.answerCount ?? node.numAnswers ?? node.answers?.length);
          if (!isNaN(ac)) entry.answerCount = Math.max(entry.answerCount || 0, ac);
          const date = node.createdAt || node.publishedAt || node.date || node.updatedAt;
          if (date && !entry.askedWhen) entry.askedWhen = normalizeDateToDDMMYYYY(String(date));
          results.set(slug, entry);
        }
      }
      for (const k of keys) visit(node[k]);
    }
  }

  visit(nextData);
  return results; // Map slug -> data
}

function parseIndexPage($) {
  const questions = [];
  
  const bodyText = $('body').text().toLowerCase();
  if (bodyText.includes('captcha') || bodyText.includes('blocked') || bodyText.includes('rate limit') || bodyText.includes('too many requests')) {
    log.warning('Possible blocking detected - page may be rate limited');
    return [];
  }
  
  const questionSelectors = [
    '[class*="question"]',
    '[class*="card"]',
    'article',
    'li',
    '.question-item',
    '.question-card'
  ];
  
  let questionElements = [];
  for (const selector of questionSelectors) {
    questionElements = $(selector);
    if (questionElements.length > 0) {
      break;
    }
  }
  
  if (questionElements.length === 0) {
    const questionLinks = $('a[href^="/questions/"]');
    questionLinks.each((_, link) => {
      const $link = $(link);
      const container = $link.closest('div, li, article');
      const questionData = parseQuestionCard($, container.length ? container : $link.parent());
      if (questionData.questionText || questionData.showPageLink) {
        questions.push(questionData);
      }
    });
  } else {
    questionElements.each((_, element) => {
      const questionData = parseQuestionCard($, element);
      if (questionData.questionText || questionData.showPageLink) {
        questions.push(questionData);
      }
    });
  }

  // Enrich from Next.js data if available (for tags, answerCount, dates)
  const nextData = tryParseNextData($);
  if (nextData) {
    const mapBySlug = collectQuestionsFromNextData(nextData);
    for (const q of questions) {
      const slug = toSlugFromUrl(q.showPageLink);
      if (!slug) continue;
      const extra = mapBySlug.get(slug);
      if (!extra) continue;
      if (!q.tags && extra.tags) q.tags = extra.tags;
      if ((!q.answerCount || q.answerCount === 0) && typeof extra.answerCount === 'number') q.answerCount = extra.answerCount;
      if (!q.companyNames && extra.companyNames) q.companyNames = extra.companyNames;
      if (!q.askedWhen && extra.askedWhen) q.askedWhen = extra.askedWhen;
      if (!q.questionText && extra.questionText) q.questionText = extra.questionText;
    }
  }
  
  return questions;
}

function parseCookies(cookieString) {
  if (!cookieString) return {};
  
  const cookies = {};
  cookieString.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = value;
    }
  });
  return cookies;
}

await Actor.init();

const input = await Actor.getInput() || {};
const {
  startPage = 1,
  endPage = 5,
  rateLimitMs = 1000,
  useApifyProxy = true,
  apiToken,
  cookies: cookieString,
  userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
} = input;

if (startPage > endPage) {
  throw new Error(`startPage (${startPage}) must be <= endPage (${endPage}).`);
}

const parsedCookies = parseCookies(cookieString);

const requestList = [];
for (let p = startPage; p <= endPage; p += 1) {
  const requestOptions = {
    url: `${INDEX}?page=${p}`,
    userData: { 
      label: 'INDEX', 
      page: p 
    }
  };

  if (apiToken) {
    requestOptions.headers = {
      'Authorization': `Bearer ${apiToken}`,
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0'
    };
  }

  if (Object.keys(parsedCookies).length > 0) {
    if (!requestOptions.headers) requestOptions.headers = {};
    requestOptions.headers['Cookie'] = cookieString;
  }

  requestList.push(requestOptions);
}

const crawler = new CheerioCrawler({
  proxyConfiguration: useApifyProxy
    ? await Actor.createProxyConfiguration()
    : undefined,
  maxConcurrency: 2,
  requestHandlerTimeoutSecs: 60,
  maxRequestsPerMinute: 30,
  maxRequestRetries: 2,
  requestHandler: async ({ request, $, log: crawleeLog }) => {
    const { label } = request.userData;

    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }

    try {
      if (label === 'INDEX') {
        const page = request.userData.page;
        crawleeLog.info(`Processing index page ${page}`);
        
        if (page > 1 && page % 5 === 0) {
          const extraDelay = 2000;
          crawleeLog.info(`Adding extra delay of ${extraDelay}ms for page ${page}`);
          await sleep(extraDelay);
        }
        
        const questions = parseIndexPage($);
        crawleeLog.info(`Found ${questions.length} questions on page ${page}`);
        
        if (questions.length === 0) {
          crawleeLog.warning(`No questions found on page ${page} - page might be empty or blocked`);
          
          if (page < endPage) {
            const blockDelay = 5000;
            crawleeLog.info(`Page ${page} appears blocked, waiting ${blockDelay}ms before continuing`);
            await sleep(blockDelay);
          }
        }
        
        for (const question of questions) {
          await Dataset.pushData(question);
        }
        
        crawleeLog.info(`Saved ${questions.length} questions from page ${page}`);
      }
    } catch (error) {
      crawleeLog.error(`Error processing ${request.url}: ${error.message}`);
      await Dataset.pushData({
        url: request.url,
        label: request.userData.label,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      await sleep(3000);
    }
  },
  failedRequestHandler: async ({ request, error }) => {
    log.error(`Request failed ${request.url}: ${error.message}`);
    await Dataset.pushData({
      url: request.url,
      label: request.userData.label,
      error: error.message,
      status: 'FAILED',
      timestamp: new Date().toISOString()
    });
    
    await sleep(5000);
  },
});

await crawler.addRequests(requestList);
await crawler.run();

log.info('Done. All questions saved to default dataset.');
await Actor.exit();