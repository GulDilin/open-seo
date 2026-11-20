/**
 * Lenient extraction of organic <doc> blocks from Yandex Search API XML
 * (the YaXML shape: response > results > grouping > group > doc with url,
 * domain, title, passage children). Workers has no DOMParser, and the
 * extraction surface is three known tags per doc — a scoped regex parse is
 * smaller and more portable than an XML machinery dependency.
 *
 * The live v2 API emits doc opening tags WITH attributes (`<doc id="...">`,
 * per Yandex's own searchapi MCP server which line-scans for `'<doc '`), so
 * the pattern must not assume a bare `<doc>`.
 */

export interface YandexDoc {
  url: string;
  domain: string;
  title: string;
}

const DOC_PATTERN = /<doc\b[^>]*>([\s\S]*?)<\/doc>/g;
const TAG_PATTERNS = {
  url: /<url>([\s\S]*?)<\/url>/,
  domain: /<domain>([\s\S]*?)<\/domain>/,
  title: /<title>([\s\S]*?)<\/title>/,
} as const;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeXmlEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => {
    if (entity.startsWith("&#")) return "'";
    return ENTITIES[entity] ?? entity;
  });
}

function firstTag(block: string, tag: keyof typeof TAG_PATTERNS): string {
  const match = TAG_PATTERNS[tag].exec(block);
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

export function parseYandexDocs(xml: string): YandexDoc[] {
  const docs: YandexDoc[] = [];
  for (const match of xml.matchAll(DOC_PATTERN)) {
    const block = match[1];
    const url = firstTag(block, "url");
    if (!url) continue;
    docs.push({
      url,
      // <domain> is optional in live responses — derive it from the url so a
      // missing tag never reads as "cannot match the target domain".
      domain: firstTag(block, "domain").toLowerCase() || hostOf(url),
      title: firstTag(block, "title"),
    });
  }
  return docs;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

interface YandexXmlError {
  code: string;
  message: string;
}

const ERROR_PATTERN = /<error\b([^>]*)>([\s\S]*?)<\/error>/;

/**
 * Yandex reports application errors inside a 200 response's XML (an <error>
 * element under <response>); there is no HTTP status for them. Code 15 means
 * "nothing found" and is not a failure.
 */
export function parseYandexError(xml: string): YandexXmlError | null {
  const match = ERROR_PATTERN.exec(xml);
  if (!match) return null;
  const code = /code="([^"]*)"/.exec(match[1])?.[1] ?? "";
  return { code, message: decodeXmlEntities(match[2].trim()) };
}
