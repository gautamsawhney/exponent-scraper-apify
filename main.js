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

function parseQuestionCard($, questionElement) {
  // Extract question text from the card
  const questionText = clean(
    $(questionElement).find('h3, h4, [class*="title"], [class*="question"]').first().text() ||
    $(questionElement).find('a').first().text()
  );

  // Extract tags from the card
  const tags = uniq([
    ...$(questionElement).find('[class*="tag"], [class*="category"], [class*="topic"]').map((_, el) => $(el).text()).get(),
    ...$(questionElement).find('a[href*="type="], a[href*="category="]').map((_, el) => $(el).text()).get()
  ]).join(', ');

  // Extract company names from the card
  const companySources = [
    ...$(questionElement).find('a[href*="?company="]').map((_, el) => $(el).text()).get(),
    ...$(questionElement).find('[class*="company"], [class*="badge"][class*="company"]').map((_, el) => $(el).text()).get(),
    ...$(questionElement).text().match(/\b(Google|Facebook|Meta|Amazon|Apple|Microsoft|Netflix|Uber|Airbnb|Twitter|LinkedIn|Salesforce|Adobe|Oracle|IBM|Intel|NVIDIA|AMD|Tesla|SpaceX|Stripe|Square|Palantir|Databricks|Snowflake|MongoDB|Atlassian|Slack|Zoom|Discord|TikTok|ByteDance|Alibaba|Tencent|Baidu)\b/gi) || []
  ];
  
  const companyNames = uniq(companySources.filter(c => c.length > 1 && c.length < 100)).join(', ');

  // Extract answer count from the card
  let answerCount = 0;
  const answerText = $(questionElement).text();
  const matches = [...answerText.matchAll(/\b(\d+)\s+answers?\b/gi)];
  if (matches.length) {
    answerCount = Math.max(...matches.map((m) => parseInt(m[1], 10)));
  } else {
    // Look for answer indicators in the card
    const answerIndicators = $(questionElement).find('[class*="answer"], [class*="response"], [class*="reply"]').length;
    answerCount = answerIndicators || 0;
  }

  // Extract date from the card
  let askedWhen = '';
  const timeElement = $(questionElement).find('time').first();
  if (timeElement.length) {
    askedWhen = normalizeDateToDDMMYYYY(timeElement.attr('datetime') || timeElement.text());
  }
  
  if (!askedWhen) {
    // Look for date patterns in the card content
    const datePatterns = [
      /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i,
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

  // Extract the question link
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

function parseIndexPage($) {
  const questions = [];
  
  // Check if we're blocked or hit a CAPTCHA
  const bodyText = $('body').text().toLowerCase();
  if (bodyText.includes('captcha') || bodyText.includes('blocked') || bodyText.includes('rate limit') || bodyText.includes('too many requests')) {
    log.warning('Possible blocking detected - page may be rate limited');
    return [];
  }
  
  // Find all question cards/containers
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
  
  // If no specific question containers found, try to find by links
  if (questionElements.length === 0) {
    const questionLinks = $('a[href^="/questions/"]');
    questionLinks.each((_, link) => {
      const $link = $(link);
      const questionData = parseQuestionCard($, $link.closest('div, li, article').length ? $link.closest('div, li, article') : $link.parent());
      if (questionData.questionText) {
        questions.push(questionData);
      }
    });
  } else {
    // Process each question container
    questionElements.each((_, element) => {
      const questionData = parseQuestionCard($, element);
      if (questionData.questionText) {
        questions.push(questionData);
      }
    });
  }
  
  return questions;
}

await Actor.init();

const input = await Actor.getInput() || {};
const {
  startPage = 1,
  endPage = 50,
  rateLimitMs = 1000, // Reduced from 3000ms to 1 second
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
  maxConcurrency: 2, // Increased to 2 for faster processing
  requestHandlerTimeoutSecs: 60, // Reduced timeout
  maxRequestsPerMinute: 30, // Increased to 30 requests per minute
  maxRequestRetries: 2, // Reduced retries
  requestHandler: async ({ request, $, log: crawleeLog }) => {
    const { label } = request.userData;

    // Apply base rate limiting
    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }

    try {
      if (label === 'INDEX') {
        const page = request.userData.page;
        crawleeLog.info(`Processing index page ${page}`);
        
        // Add minimal extra delay for pages that might be rate limited
        if (page > 1 && page % 5 === 0) { // Only add delay every 5 pages
          const extraDelay = 2000; // 2 second delay every 5 pages
          crawleeLog.info(`Adding extra delay of ${extraDelay}ms for page ${page}`);
          await sleep(extraDelay);
        }
        
        const questions = parseIndexPage($);
        crawleeLog.info(`Found ${questions.length} questions on page ${page}`);
        
        if (questions.length === 0) {
          crawleeLog.warning(`No questions found on page ${page} - page might be empty or blocked`);
          
          // If we get blocked, wait a bit longer but not too much
          if (page < endPage) {
            const blockDelay = 5000; // 5 second delay if blocked
            crawleeLog.info(`Page ${page} appears blocked, waiting ${blockDelay}ms before continuing`);
            await sleep(blockDelay);
          }
        }
        
        // Save all questions from this page
        for (const question of questions) {
          await Dataset.pushData(question);
        }
        
        crawleeLog.info(`Saved ${questions.length} questions from page ${page}`);
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
      
      // If error occurs, wait a bit longer but not too much
      await sleep(3000);
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
    
    // Wait a bit after failed requests but not too much
    await sleep(5000);
  },
});

await crawler.addRequests(requestList);
await crawler.run();

log.info('Done. All questions saved to default dataset.');
await Actor.exit();