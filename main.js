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

  // Enhanced tag extraction with more selectors
  const tagSelectors = [
    '[class*="tag"]',
    '[class*="category"]', 
    '[class*="topic"]',
    '[class*="label"]',
    '[class*="badge"]',
    '[data-testid*="tag"]',
    '[data-testid*="category"]',
    'a[href*="type="]',
    'a[href*="category="]',
    'a[href*="tag="]',
    'span[class*="tag"]',
    'div[class*="tag"]'
  ];
  
  const tags = uniq([
    ...tagSelectors.flatMap(selector => 
      $(questionElement).find(selector).map((_, el) => clean($(el).text())).get()
    )
  ]).filter(tag => tag.length > 0 && tag.length < 50).join(', ');

  const companySources = [
    ...$(questionElement).find('a[href*="?company="]').map((_, el) => $(el).text()).get(),
    ...$(questionElement).find('[class*="company"], [class*="badge"][class*="company"]').map((_, el) => $(el).text()).get(),
    ...$(questionElement).text().match(/\b(Google|Facebook|Meta|Amazon|Apple|Microsoft|Netflix|Uber|Airbnb|Twitter|LinkedIn|Salesforce|Adobe|Oracle|IBM|Intel|NVIDIA|AMD|Tesla|SpaceX|Stripe|Square|Palantir|Databricks|Snowflake|MongoDB|Atlassian|Slack|Zoom|Discord|TikTok|ByteDance|Alibaba|Tencent|Baidu)\b/gi) || []
  ];
  
  const companyNames = uniq(companySources.filter(c => c.length > 1 && c.length < 100)).join(', ');

  // Enhanced answer count extraction
  let answerCount = 0;
  const answerText = $(questionElement).text();
  
  // Try multiple patterns for answer count
  const answerPatterns = [
    /\b(\d+)\s+answers?\b/gi,
    /\b(\d+)\s+replies?\b/gi,
    /\b(\d+)\s+responses?\b/gi,
    /answers?\s*[:\-]?\s*(\d+)/gi,
    /replies?\s*[:\-]?\s*(\d+)/gi,
    /responses?\s*[:\-]?\s*(\d+)/gi
  ];
  
  for (const pattern of answerPatterns) {
    const matches = [...answerText.matchAll(pattern)];
    if (matches.length) {
      answerCount = Math.max(...matches.map((m) => parseInt(m[1], 10)));
      break;
    }
  }
  
  // Fallback: count answer-related elements
  if (answerCount === 0) {
    const answerSelectors = [
      '[class*="answer"]',
      '[class*="response"]', 
      '[class*="reply"]',
      '[class*="comment"]',
      '[data-testid*="answer"]',
      '[data-testid*="response"]'
    ];
    answerCount = answerSelectors.reduce((count, selector) => {
      return count + $(questionElement).find(selector).length;
    }, 0);
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
    return parts.length >= 2 ? parts[1] : parts[parts.length - 1];
  } catch {
    return '';
  }
}

function collectQuestionsFromNextData(nextData) {
  const results = new Map();
  log.info('Starting Next.js data collection...');

  function visit(node, path = '') {
    if (!node) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        visit(node[i], `${path}[${i}]`);
      }
      return;
    }
    if (typeof node === 'object') {
      const keys = Object.keys(node);
      
      // Look for question-like objects with more flexible matching
      const hasQuestionId = 'id' in node || 'questionId' in node || 'slug' in node;
      const hasQuestionContent = 'title' in node || 'question' in node || 'name' in node || 'content' in node;
      const hasQuestionPath = typeof node.href === 'string' && node.href.includes('/questions/');
      const hasQuestionUrl = typeof node.url === 'string' && node.url.includes('/questions/');
      
      if ((hasQuestionId || hasQuestionPath || hasQuestionUrl) && hasQuestionContent) {
        const href = node.href || node.url || (typeof node.slug === 'string' ? `/questions/${node.slug}` : undefined);
        if (href && href.includes('/questions/')) {
          const fullUrl = href.startsWith('http') ? href : new URL(href, BASE).toString();
          const slug = toSlugFromUrl(fullUrl);
          
          if (slug) {
            const entry = results.get(slug) || { showPageLink: fullUrl };
            
            // Extract question text
            entry.questionText = entry.questionText || String(node.title || node.question || node.name || node.content || '').trim();
            
            // Extract tags with more field names
            const tagsArr = [];
            if (Array.isArray(node.tags)) tagsArr.push(...node.tags.map(String));
            if (Array.isArray(node.categories)) tagsArr.push(...node.categories.map(String));
            if (Array.isArray(node.topics)) tagsArr.push(...node.topics.map(String));
            if (Array.isArray(node.labels)) tagsArr.push(...node.labels.map(String));
            if (typeof node.tag === 'string') tagsArr.push(node.tag);
            if (typeof node.category === 'string') tagsArr.push(node.category);
            if (typeof node.topic === 'string') tagsArr.push(node.topic);
            
            if (tagsArr.length > 0) {
              entry.tags = uniq([...(entry.tags ? entry.tags.split(',') : []), ...tagsArr]).join(', ');
            }
            
            // Extract companies
            const companies = [];
            if (Array.isArray(node.companies)) companies.push(...node.companies.map(String));
            if (typeof node.company === 'string') companies.push(node.company);
            if (companies.length > 0) {
              entry.companyNames = uniq([...(entry.companyNames ? entry.companyNames.split(',') : []), ...companies]).join(', ');
            }
            
            // Extract answer count with more field names
            const answerCountFields = ['answersCount', 'answerCount', 'numAnswers', 'answers_count', 'answer_count', 'totalAnswers', 'total_answers'];
            for (const field of answerCountFields) {
              if (field in node) {
                const ac = Number(node[field]);
                if (!isNaN(ac) && ac > 0) {
                  entry.answerCount = Math.max(entry.answerCount || 0, ac);
                  break;
                }
              }
            }
            
            // Check if answers array exists
            if (Array.isArray(node.answers) && node.answers.length > 0) {
              entry.answerCount = Math.max(entry.answerCount || 0, node.answers.length);
            }
            
            // Extract date
            const dateFields = ['createdAt', 'publishedAt', 'date', 'updatedAt', 'created_at', 'published_at', 'updated_at'];
            for (const field of dateFields) {
              if (field in node && !entry.askedWhen) {
                entry.askedWhen = normalizeDateToDDMMYYYY(String(node[field]));
                if (entry.askedWhen) break;
              }
            }
            
            results.set(slug, entry);
            log.info(`Found question data for slug ${slug}: tags=${entry.tags}, answers=${entry.answerCount}`);
          }
        }
      }
      
      // Continue traversing
      for (const k of keys) {
        visit(node[k], `${path}.${k}`);
      }
    }
  }

  visit(nextData);
  log.info(`Next.js data collection complete. Found ${results.size} questions.`);
  return results;
}

function mergeQuestionData(base, extra) {
  if (!extra) return base;
  return {
    questionText: base.questionText || extra.questionText || '',
    companyNames: base.companyNames || extra.companyNames || '',
    askedWhen: base.askedWhen || extra.askedWhen || '',
    tags: base.tags || extra.tags || '',
    answerCount: (base.answerCount && base.answerCount > 0) ? base.answerCount : (extra.answerCount || 0),
    showPageLink: base.showPageLink || extra.showPageLink || ''
  };
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

  const nextData = tryParseNextData($);
  if (nextData) {
    const mapBySlug = collectQuestionsFromNextData(nextData);
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      const slug = toSlugFromUrl(q.showPageLink);
      if (!slug) continue;
      const extra = mapBySlug.get(slug);
      questions[i] = mergeQuestionData(q, extra);
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
  userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  fetchDetailMeta = true
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
  requestHandler: async ({ request, $, log: crawleeLog, enqueueLinks, parseWithCheerio }) => {
    const { label } = request.userData;

    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }

    try {
      if (label === 'INDEX') {
        const page = request.userData.page;
        crawleeLog.info(`Processing index page ${page}`);
        
        const questions = parseIndexPage($);
        crawleeLog.info(`Found ${questions.length} questions on page ${page}`);
        
        // Log sample question data for debugging
        if (questions.length > 0) {
          const sample = questions[0];
          crawleeLog.info(`Sample question: title="${sample.questionText}", tags="${sample.tags}", answers=${sample.answerCount}`);
        }

        if (fetchDetailMeta) {
          crawleeLog.info(`Enqueueing ${questions.length} detail requests for page ${page}`);
          for (const q of questions) {
            if (!q.showPageLink) continue;
            await crawler.addRequests([{ url: q.showPageLink, userData: { label: 'DETAIL', base: q } }]);
          }
        } else {
          for (const q of questions) await Dataset.pushData(q);
        }
      } else if (label === 'DETAIL') {
        const base = request.userData.base || {};
        crawleeLog.info(`Processing detail page: ${request.url}`);
        
        // Parse __NEXT_DATA__ on detail page
        const nextData = tryParseNextData($);
        let detailExtra = null;
        if (nextData) {
          crawleeLog.info('Found Next.js data on detail page');
          const mapBySlug = collectQuestionsFromNextData(nextData);
          const slug = toSlugFromUrl(base.showPageLink || request.url);
          detailExtra = mapBySlug.get(slug) || null;
          if (detailExtra) {
            crawleeLog.info(`Detail extra data: tags="${detailExtra.tags}", answers=${detailExtra.answerCount}`);
          } else {
            crawleeLog.warning(`No detail extra data found for slug: ${slug}`);
          }
        } else {
          crawleeLog.warning('No Next.js data found on detail page');
        }
        
        const merged = mergeQuestionData(base, detailExtra);
        crawleeLog.info(`Final merged data: tags="${merged.tags}", answers=${merged.answerCount}`);
        await Dataset.pushData(merged);
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