/**
 * Lenient extraction of organic <doc> blocks from Yandex Search API XML
 * (the old YaXML shape: response > results > grouping > group > doc with
 * url, domain, title, passage children). Workers has no DOMParser, and the
 * extraction surface is three known tags per doc — a scoped regex parse is
 * smaller and more portable than an XML machinery dependency.
 *
 * AT INTEGRATION: record a live rawData fixture with a real key and diff
 * against this parser's output (task 004/T001).
 */

export interface YandexDoc {
  url: string;
  domain: string;
  title: string;
}

const DOC_PATTERN = /<doc>([\s\S]*?)<\/doc>/g;
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
      domain: firstTag(block, "domain").toLowerCase(),
      title: firstTag(block, "title"),
    });
  }
  return docs;
}
