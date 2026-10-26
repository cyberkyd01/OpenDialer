import { Fragment, type ReactNode } from 'react';

/** **bold** → <strong>. Everything else is plain text (React escapes it). */
export function renderInline(text: string, keyPrefix = ''): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${keyPrefix}b${i++}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Minimal, safe "markdown-ish" renderer for call scripts: blank lines split
 * paragraphs, single newlines become <br>, **text** is bold, "# " lines become
 * headings and blocks of "- " lines become bullet lists. Never uses innerHTML.
 */
export function ScriptMarkup({ text }: { text: string }) {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.replace(/^\n+|\s+$/g, ''))
    .filter((b) => b.trim());
  return (
    <div className="script-body">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const h = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
        if (h && lines.length === 1) {
          const content = renderInline(h[2], `h${bi}`);
          return h[1].length === 1 ? <h3 key={bi}>{content}</h3> : <h4 key={bi}>{content}</h4>;
        }
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ''), `l${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(l, `p${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
