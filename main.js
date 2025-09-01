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
    clean($('h2').first().text());

  const tags = uniq([
    ...$('[class*="tag"]').map((_, el) => $(el).text()).get(),
    ...$('a[href^="/questions?type="], a[href^="/questions?category="]').map((_, el) => $(el).text()).get()
  ]).join(', ');

  const companiesFromQuery = $('a[href*=\"?company=\"]').map((_, el) => $(el).text()).get();
  const companyNames = uniq(companiesFromQuery).join(', ');

  let answerCount = 0;
  const textNodes = $('body').text();
  const matches = [...textNodes.matchAll(/\b(\d+)\s+answers?\b/gi)];
  if (matches.length) {
    answerCount = Math.max(...matches.map((m) => parseInt(m[1], 10)));
  } else {
    const blockCount = $('[class*=\"answer\"], [id*=\"answer\"], article[data-answer-id]').length;
    answerCount = blockCount || 0;
  }

  let askedWhen = '';
  const t = $('time').first().attr('datetime') || $('time').first().text();
  if (t) askedWhen = normalizeDateToDDMMYYYY(t);
  if (!askedWhen) {
    const all = $('body').text();
    const monthDate = all.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i);
    if (monthDate) askedWhen = normalizeDateToDDMMYYYY(monthDate[0]);
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
  maxConcurrency: 5,
  requestHandlerTimeoutSecs: 60,
  maxRequestsPerMinute: 60,
  requestHandler: async ({ request, $, log: crawleeLog }) => {
    const { label } = request.userData;

    if (rateLimitMs > 0) await sleep(rateLimitMs);

    if (label === 'INDEX') {
      const page = request.userData.page;
      crawleeLog.info(`Index page ${page}`);
      const detailUrls = parseIndexPage($);
      for (const url of detailUrls) {
        await Actor.addRequests([{ url, userData: { label: 'DETAIL' } }], { forefront: false });
      }
    } else if (label === 'DETAIL') {
      const item = parseQuestionPage($, request.url);
      if (item.questionText) {
        await Dataset.pushData(item);
      } else {
        crawleeLog.warning(`Empty title on: ${request.url}`);
      }
    }
  },
  failedRequestHandler: async ({ request }) => {
    log.error(`Request failed ${request.url}`);
  },
});

await crawler.addRequests(requestList);
await crawler.run();

log.info('Done. Items saved to default dataset.');
await Actor.exit();