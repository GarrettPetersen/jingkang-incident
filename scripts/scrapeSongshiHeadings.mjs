import { load } from 'cheerio';

const BOOK_URLS = {
  songshi: 'https://chinesenotes.com/songshi.html',
  jinshi: 'https://chinesenotes.com/jinshi.html'
};

function resolveTargetUrl(arg) {
  if (!arg) return BOOK_URLS.songshi;
  if (/^https?:\/\//i.test(arg)) return arg;
  const key = arg.toLowerCase();
  if (BOOK_URLS[key]) return BOOK_URLS[key];
  throw new Error(`Unknown book "${arg}". Supported: ${Object.keys(BOOK_URLS).join(', ')} or a full URL.`);
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function extractHeadings($) {
  const results = [];
  $('li').each((_, li) => {
    const text = normalizeWhitespace($(li).text());
    // Heuristics: capture list items that look like chapter/volume headings
    const looksChinese = /^卷[一二三四五六七八九十百千〇零]+/.test(text);
    const looksEnglish = /^Volume\s+\d+\b/.test(text);
    if (looksChinese || looksEnglish) {
      // Attempt to split into Chinese and English parts, if present
      // Example: "卷一 本紀第一 太祖一 Volume 1 Annals 1: Taizu 1"
      const splitIdx = text.indexOf(' Volume ');
      let chinese = undefined;
      let english = undefined;
      if (splitIdx !== -1) {
        chinese = normalizeWhitespace(text.slice(0, splitIdx));
        english = normalizeWhitespace(text.slice(splitIdx + 1));
      } else {
        // Fallback: return full text if we can't confidently split
        chinese = looksChinese ? text : undefined;
        english = looksEnglish ? text : undefined;
      }
      results.push({ chinese, english, raw: text });
    }
  });
  return results;
}

async function main() {
  const arg = process.argv[2];
  const targetUrl = resolveTargetUrl(arg);
  try {
    const res = await fetch(targetUrl, { headers: { 'user-agent': 'jingkang-incident-scraper/1.0' } });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${targetUrl}: ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const $ = load(html);
    const headings = extractHeadings($);
    // Print JSON to stdout
    console.log(JSON.stringify({ url: targetUrl, count: headings.length, headings }, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

await main();


