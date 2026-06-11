import crypto from 'node:crypto';

const MAX_CHUNK = 800;
const OVERLAP = 120;

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return [{}, text];
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m) continue;
    const [, key, raw] = m;
    meta[key] = raw.startsWith('[')
      ? raw.replace(/[[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean)
      : raw.trim();
  }
  return [meta, text.slice(match[0].length)];
}

function splitLong(content) {
  if (content.length <= MAX_CHUNK) return [content];
  const paragraphs = content.split(/\n\n+/);
  const pieces = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && (current.length + p.length + 2) > MAX_CHUNK) {
      pieces.push(current);
      current = current.slice(-OVERLAP) + '\n\n' + p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function parseSourceFile(text, filename) {
  const [meta, body] = parseFrontmatter(String(text || ''));
  const docId = filename.replace(/\.md$/, '');
  const resource = `kb://grammar/${docId}`;
  const sections = body.split(/\n(?=## )/).map(s => s.trim()).filter(s => s.startsWith('## '));
  const chunks = [];
  for (const section of sections) {
    const lines = section.split('\n');
    const title = lines[0].replace(/^##\s*/, '').trim();
    let level = meta.level || '';
    const contentLines = [];
    for (const line of lines.slice(1)) {
      const override = line.match(/^>\s*level:\s*(\S+)/i);
      if (override) { level = override[1]; continue; }
      contentLines.push(line);
    }
    const content = contentLines.join('\n').trim();
    if (!content) continue;
    splitLong(content).forEach((piece, index) => {
      const pieceTitle = index === 0 ? title : `${title} (${index + 1})`;
      chunks.push({
        docId,
        resource,
        title: pieceTitle,
        content: piece,
        level,
        category: meta.category || '',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        source: filename,
        contentHash: crypto.createHash('sha256').update(`${pieceTitle}\n${piece}`).digest('hex')
      });
    });
  }
  return chunks;
}
