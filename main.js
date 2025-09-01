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
  const m2 = raw.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i);
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

function parseQuestionPage($, url) {
  const questionText =
    clean($('h1').first().text()) ||
    clean($('h2').first().text()) ||
    clean($('[class*="question-title"], [class*="title"]').first().text());

  // Extract tags from multiple possible sources
  const tags = uniq([
    ...$('[class*="tag"]').map((_, el) => $(el).text()).get(),
    ...$('a[href^="/questions?type="], a[href^="/questions?category="]').map((_, el) => $(el).text()).get(),
    ...$('[class*="category"], [class*="topic"]').map((_, el) => $(el).text()).get()
  ]).join(', ');

  // Extract company names from multiple sources
  const companySources = [
    // From query parameters in links
    ...$('a[href*="?company="]').map((_, el) => $(el).text()).get(),
    // From company badges or labels
    ...$('[class*="company"], [class*="badge"][class*="company"]').map((_, el) => $(el).text()).get(),
    // From text content mentioning companies
    ...$('body').text().match(/\b(?:at|from|asked at)\s+([A-Z][a-zA-Z\s&]+(?:Inc|Corp|LLC|Ltd|Company|Co\.?))\b/gi)?.map(m => m.replace(/^(?:at|from|asked at)\s+/i, '')) || [],
    // Common tech companies
    ...$('body').text().match(/\b(Google|Facebook|Meta|Amazon|Apple|Microsoft|Netflix|Uber|Airbnb|Twitter|LinkedIn|Salesforce|Adobe|Oracle|IBM|Intel|NVIDIA|AMD|Tesla|SpaceX|Stripe|Square|Palantir|Databricks|Snowflake|MongoDB|Atlassian|Slack|Zoom|Discord|TikTok|ByteDance|Alibaba|Tencent|Baidu|ByteDance)\b/gi) || []
  ];
  
  const companyNames = uniq(companySources.filter(c => c.length > 1 && c.length < 100)).join(', ');

  let answerCount = 0;
  const textNodes = $('body').text();
  const matches = [...textNodes.matchAll(/\b(\d+)\s+answers?\b/gi)];
  if (matches.length) {
    answerCount = Math.max(...matches.map((m) => parseInt(m[1], 10)));
  } else {
    // Look for answer containers
    const answerSelectors = [
      '[class*="answer"]',
      '[id*="answer"]', 
      'article[data-answer-id]',
      '[class*="response"]',
      '[class*="reply"]'
    ];
    answerCount = answerSelectors.reduce((count, selector) => {
      return count + $(selector).length;
    }, 0);
  }

  // Extract date more robustly
  let askedWhen = '';
  const timeElement = $('time').first();
  if (timeElement.length) {
    askedWhen = normalizeDateToDDMMYYYY(timeElement.attr('datetime') || timeElement.text());
  }
  
  if (!askedWhen) {
    // Look for date patterns in the content
    const datePatterns = [
      /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+20\d{2}\b/i,
      /\b\d{1,2}\/(\d{1,2})\/\d{4}\b/,
      /\b\d{4}-\d{2}-\d{2}\b/
    ];
    
    for (const pattern of datePatterns) {
      const match = $('body').text().match(pattern);
      if (match) {
        askedWhen = normalizeDateToDDMMYYYY(match[0]);
        break;
      }
    }
  }

  return {
    questionText,
    companyNames,
    askedWhen,
    tags,
    answerCount,
    answersUrl: url,
  };
}

function parseIndexPage($) {
  const links = new Set();
  
  // Check if we're blocked or hit a CAPTCHA
  const bodyText = $('body').text().toLowerCase();
  if (bodyText.includes('captcha') || bodyText.includes('blocked') || bodyText.includes('rate limit') || bodyText.includes('too many requests')) {
    log.warning('Possible blocking detected - page may be rate limited');
    return [];
  }
  
  $('a[href^=\"/questions/\"]').each((_, a) => {
    const href = String($(a).attr('href') || '');
    if (href.startsWith('/questions/') && !href.includes('?') && !href.includes('#')) {
      links.add(new URL(href, BASE).toString());
    }
  });
  return [...links];
}

await Actor.init();

const input = await Actor.getInput() || {};
const {
  startPage = 1,
  endPage = 202,
  rateLimitMs = 800,
  useApifyProxy = true,
} = input;

if (startPage > endPage) {
  throw new Error(`startPage (${startPage}) must be <= endPage (${endPage}).`);
}

const requestList = [];
for (let p = startPage; p <= endPage; p += 1) {
  requestList.push({ url: `${INDEX}?page=${p}`, userData: { label: 'INDEX', page: p } });
}

const crawler = new CheerioCrawler({
  proxyConfiguration: useApifyProxy
    ? await Actor.createProxyConfiguration()
    : undefined,
  maxConcurrency: 3, // Reduced from 5 to be more respectful
  requestHandlerTimeoutSecs: 60,
  maxRequestsPerMinute: 45, // Reduced from 60 to be more respectful
  maxRequestRetries: 2, // Retry failed requests up to 2 times
  requestHandler: async ({ request, $, log: crawleeLog }) => {
    const { label } = request.userData;

    if (rateLimitMs > 0) await sleep(rateLimitMs);

    try {
      if (label === 'INDEX') {
        const page = request.userData.page;
        crawleeLog.info(`Processing index page ${page}`);
        const detailUrls = parseIndexPage($);
        crawleeLog.info(`Found ${detailUrls.length} questions on page ${page}`);
        
        if (detailUrls.length === 0) {
          crawleeLog.warning(`No questions found on page ${page} - page might be empty or blocked`);
        }
        
        for (const url of detailUrls) {
          await crawler.addRequests([{ url, userData: { label: 'DETAIL' } }]);
        }
      } else if (label === 'DETAIL') {
        const item = parseQuestionPage($, request.url);
        if (item.questionText) {
          await Dataset.pushData(item);
          crawleeLog.info(`Scraped question: "${item.questionText.substring(0, 50)}..."`);
        } else {
          crawleeLog.warning(`Empty question text on: ${request.url}`);
          // Still save the item with available data for debugging
          await Dataset.pushData({
            ...item,
            questionText: 'NO_TITLE_FOUND',
            error: 'Could not extract question text'
          });
        }
      }
    } catch (error) {
      crawleeLog.error(`Error processing ${request.url}: ${error.message}`);
      // Save error information for debugging
      await Dataset.pushData({
        url: request.url,
        label: request.userData.label,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  },
  failedRequestHandler: async ({ request, error }) => {
    log.error(`Request failed ${request.url}: ${error.message}`);
    // Save failed request info for debugging
    await Dataset.pushData({
      url: request.url,
      label: request.userData.label,
      error: error.message,
      status: 'FAILED',
      timestamp: new Date().toISOString()
    });
  },
});

await crawler.addRequests(requestList);
await crawler.run();

log.info('Done. Items saved to default dataset.');
await Actor.exit();