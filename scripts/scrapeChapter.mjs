import { load } from 'cheerio';

function normalizeWhitespace(text) {
  return text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitTitle(rawTitle) {
  const text = normalizeWhitespace(rawTitle);
  const idx = text.indexOf(' Volume ');
  const chinese = idx !== -1 ? text.slice(0, idx) : text;
  const english = idx !== -1 ? text.slice(idx + 1) : undefined;
  return { chinese, english, raw: text };
}

function isMostlyChinese(text) {
  const t = text.replace(/[\s\u200B\uFEFF]+/g, '');
  if (!t) return false;
  const chineseMatches = t.match(/[\p{Script=Han}]/gu);
  const latinMatches = t.match(/[A-Za-z]/g);
  const chineseCount = chineseMatches ? chineseMatches.length : 0;
  const latinCount = latinMatches ? latinMatches.length : 0;
  // Heuristic: include if there is some Chinese and Chinese chars >= Latin chars
  return chineseCount > 0 && chineseCount >= latinCount;
}

function extractParagraphs($) {
  const paragraphs = [];

  function shouldStop($el) {
    const t = normalizeWhitespace($el.text()).toLowerCase();
    if (!t) return false;
    return (
      t.startsWith('chinese text:') ||
      t.includes('glossary and other vocabulary') ||
      t.startsWith('dictionary cache status') ||
      t.startsWith('copyright') ||
      t.startsWith('abbreviations') ||
      t.startsWith('reference') ||
      t.startsWith('help') ||
      t.startsWith('about')
    );
  }

  function extractFromElement($el) {
    const $clone = $el.clone();
    $clone.find('br').replaceWith('\n');
    const raw = $clone.text().replace(/\r\n?/g, '\n');
    const lines = raw.split(/\n+/).map(normalizeWhitespace).filter(Boolean);
    for (const line of lines) {
      if (isMostlyChinese(line)) paragraphs.push(line);
    }
  }

  const $title = $('h3').first().length ? $('h3').first() : $('h2').first();
  if ($title.length) {
    let $cursor = $title.next();
    const safetyLimit = 2000;
    let steps = 0;
    while ($cursor && $cursor.length && steps < safetyLimit) {
      steps++;
      if (shouldStop($cursor)) break;
      const tag = ($cursor[0].tagName || '').toLowerCase();
      if (tag === 'h2' || tag === 'h3') break;
      if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
        extractFromElement($cursor);
      }
      $cursor = $cursor.next();
    }
  }

  // Fallback: if nothing captured, scan all paragraphs and divs
  if (paragraphs.length === 0) {
    $('p, div').each((_, el) => extractFromElement($(el)));
  }

  // De-duplicate consecutive identical lines (rare but can happen)
  const deduped = [];
  for (const line of paragraphs) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }
  return deduped;
}

function inferBook(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('chinesenotes.com')) {
      if (u.pathname.includes('/songshi/')) return 'songshi';
      if (u.pathname.includes('/jinshi/')) return 'jinshi';
    }
  } catch {}
  return undefined;
}

async function main() {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    console.error('Usage: node scripts/scrapeChapter.mjs <chapter_url>');
    process.exit(1);
  }
  try {
    const res = await fetch(targetUrl, { headers: { 'user-agent': 'jingkang-incident-scraper/1.0' } });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${targetUrl}: ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const $ = load(html);

    const h3 = $('h3').first().text() || $('h2').first().text() || '';
    const title = splitTitle(h3 || '');
    const book = inferBook(targetUrl);
    const paragraphs = extractParagraphs($);

    const result = {
      url: targetUrl,
      book,
      title,
      count: paragraphs.length,
      paragraphs
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

await main();


