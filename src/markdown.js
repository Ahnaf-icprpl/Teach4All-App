import van from 'vanjs-core';
import { icon } from './icons.js';
import { toast, modal } from './state.js';
import { fetchQuizzes, fetchMaterials } from './studyModules.js';
import { t } from './uiTexts.js';

const {
  div, p, h1, h2, h3, h4, ul, ol, li, pre, code,
  blockquote, strong, em, a, hr, table, thead, tbody, tr, th, td, span, button, br,
} = van.tags;

function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
    return false;
  }
  return true;
}

export function formatMaterialMarkdown(content) {
  if (!content || typeof content !== 'string') return '';
  let text = content;

  if (text.includes('\\n')) {
    text = text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  text = text.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
  text = text.replace(/^([-*+])([^\s\-*+])/gm, '$1 $2');
  text = text.replace(/^(\d+\.)([^\s\d])/gm, '$1 $2');
  text = text.replace(/^(>+)([^\s>])/gm, '$1 $2');

  text = text.replace(/([^\n])\n(#{1,6}\s+)/g, '$1\n\n$2');
  text = text.replace(/([^\n])\n(>\s+)/g, '$1\n\n$2');
  text = text.replace(/([^\n\-*+\d>#])\n([-*+]\s+|\d+\.\s+)/g, '$1\n\n$2');

  text = text.split('\n').map(line => line.trimEnd()).join('\n');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function parseInline(text) {
  if (!text) return [];
  const results = [];
  const pattern = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|___[^_]+___|__[^_]+__|_[^_]+_|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      results.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      results.push(code({ class: 'inline-code' }, token.slice(1, -1)));
    } else if (token.startsWith('***')) {
      results.push(strong(em(token.slice(3, -3))));
    } else if (token.startsWith('**')) {
      results.push(strong(token.slice(2, -2)));
    } else if (token.startsWith('*')) {
      results.push(em(token.slice(1, -1)));
    } else if (token.startsWith('___')) {
      results.push(strong(em(token.slice(3, -3))));
    } else if (token.startsWith('__')) {
      results.push(strong(token.slice(2, -2)));
    } else if (token.startsWith('_')) {
      results.push(em(token.slice(1, -1)));
    } else if (token.startsWith('~~')) {
      results.push(span({ class: 'strikethrough' }, token.slice(2, -2)));
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const linkText = linkMatch[1];
        const rawHref = linkMatch[2].trim();
        const safeHref = isSafeUrl(rawHref) ? rawHref : '#';
        results.push(a({
          href: safeHref,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'markdown-link',
        }, linkText));
      } else {
        results.push(token);
      }
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    results.push(text.slice(lastIndex));
  }

  return results;
}

export function renderMarkdown(content) {
  if (!content || typeof content !== 'string') return div();
  const normalized = formatMaterialMarkdown(content);
  const lines = normalized.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Interactive Quiz Card marker (:::quiz-card{...}:::)
    const quizMatch = line.trim().match(/^:::quiz-card\{([^}]+)\}:::$/);
    if (quizMatch) {
      const attrsStr = quizMatch[1];
      const attrs = {};
      const attrRegex = /(\w+)="([^"]*)"/g;
      let m;
      while ((m = attrRegex.exec(attrsStr)) !== null) {
        attrs[m[1]] = m[2];
      }
      const quizId = attrs.id;
      const title = attrs.title || t('dialogs_title_quiz');
      const category = attrs.category || t('sidebar_quiz_button');
      const count = attrs.count || '20';

      elements.push(
        div({ class: 'chat-quiz-card' },
          div({ class: 'chat-quiz-card-header' },
            div({ class: 'chat-quiz-badge' }, icon('bulb'), span(category)),
            span({ class: 'chat-quiz-count' }, () => `${count} ${t('dialogs_meta_questions_suffix')}`),
          ),
          h3({ class: 'chat-quiz-title' }, title),
          button({
            type: 'button',
            class: 'chat-quiz-start-btn',
            onclick: () => {
              fetchQuizzes().catch(() => {});
              modal.val = { type: 'quiz-solver', id: quizId };
            },
          }, icon('play'), span(() => t('dialogs_quiz_start_button'))),
        )
      );
      i++;
      continue;
    }

    // Interactive Material Card marker (:::material-card{...}:::)
    const matMatch = line.trim().match(/^:::material-card\{([^}]+)\}:::$/);
    if (matMatch) {
      const attrsStr = matMatch[1];
      const attrs = {};
      const attrRegex = /(\w+)="([^"]*)"/g;
      let m;
      while ((m = attrRegex.exec(attrsStr)) !== null) {
        attrs[m[1]] = m[2];
      }
      const materialId = attrs.id;
      const title = attrs.title || t('dialogs_title_material');
      const category = attrs.category || t('sidebar_material_button');
      const count = attrs.count || '1';
      const readTime = attrs.readTime || '5';

      elements.push(
        div({ class: 'chat-material-card' },
          div({ class: 'chat-material-card-header' },
            div({ class: 'chat-material-badge' }, icon('book'), span(category)),
            span({ class: 'chat-material-count' }, () => `${count} ${t('dialogs_meta_parts_suffix')} • ${readTime} ${t('dialogs_meta_read_time_suffix')}`),
          ),
          h3({ class: 'chat-material-title' }, title),
          button({
            type: 'button',
            class: 'chat-material-read-btn',
            onclick: () => {
              fetchMaterials().catch(() => {});
              modal.val = { type: 'material-reader', id: materialId };
            },
          }, icon('book'), span(() => t('dialogs_material_open_button'))),
        )
      );
      i++;
      continue;
    }

    // 1. Fenced code blocks (```lang ... ```)
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++;
      }
      const codeString = codeLines.join('\n');
      elements.push(
        div({ class: 'code-block' },
          div({ class: 'code-header' },
            span({ class: 'code-lang' }, lang || 'code'),
            button({
              type: 'button',
              class: 'code-copy-btn',
              'aria-label': () => t('markdown_copy_code_aria'),
              title: () => t('markdown_copy_code_aria'),
              onclick: () => {
                navigator.clipboard?.writeText(codeString).then(() => {
                  toast(t('markdown_copy_code_success'));
                }).catch(() => {
                  toast(t('chat_copy_fail'));
                });
              },
            }, icon('copy'), span(() => t('markdown_copy_code_button'))),
          ),
          pre(code({ class: lang ? `language-${lang}` : '' }, codeString)),
        )
      );
      continue;
    }

    // 2. Horizontal rules (---, ***, ___)
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      elements.push(hr({ class: 'markdown-divider' }));
      i++;
      continue;
    }

    // 3. Headings (# h1, ## h2, ### h3, #### h4)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      const headingTag = level === 1 ? h1 : (level === 2 ? h2 : (level === 3 ? h3 : h4));
      elements.push(headingTag({ class: `markdown-heading markdown-h${level}` }, ...parseInline(headingText)));
      i++;
      continue;
    }

    // 4. Blockquotes (> ...)
    if (line.trim().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      elements.push(blockquote({ class: 'markdown-blockquote' }, ...parseInline(quoteLines.join(' '))));
      continue;
    }

    // 5. Unordered list (- item, * item, + item)
    if (/^\s*[-*+]\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*+]\s+/, '');
        listItems.push(li(...parseInline(itemText)));
        i++;
      }
      elements.push(ul({ class: 'markdown-list markdown-ul' }, ...listItems));
      continue;
    }

    // 6. Ordered list (1. item, 2. item)
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, '');
        listItems.push(li(...parseInline(itemText)));
        i++;
      }
      elements.push(ol({ class: 'markdown-list markdown-ol' }, ...listItems));
      continue;
    }

    // 7. Table (| col1 | col2 |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|') && i + 1 < lines.length && /^\s*\|?\s*[-:]+[-| :]*\s*\|?\s*$/.test(lines[i + 1])) {
      const headerRow = line.trim().slice(1, -1).split('|').map(s => s.trim());
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const rowCells = lines[i].trim().slice(1, -1).split('|').map(s => s.trim());
        bodyRows.push(rowCells);
        i++;
      }
      elements.push(
        div({ class: 'table-wrap' },
          table({ class: 'markdown-table' },
            thead(tr(headerRow.map(h => th(...parseInline(h))))),
            tbody(bodyRows.map(row => tr(row.map(c => td(...parseInline(c)))))),
          )
        )
      );
      continue;
    }

    // 8. Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // 9. Paragraph (consecutive lines)
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !/^(\s*[-*_]\s*){3,}$/.test(lines[i]) &&
      !lines[i].match(/^(#{1,6})\s+/) &&
      !lines[i].trim().startsWith('>') &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|'))
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      const paraContent = [];
      paraLines.forEach((pLine, pIdx) => {
        if (pIdx > 0) paraContent.push(br());
        paraContent.push(...parseInline(pLine));
      });
      elements.push(p({ class: 'markdown-p' }, ...paraContent));
    }
  }

  return div({ class: 'markdown-body' }, ...elements);
}

export default renderMarkdown;
