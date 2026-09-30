export type TokenKind = 'key' | 'string' | 'number' | 'plain';

export interface JsonLine {
  /** Leading spaces, applied as padding so a wrapped line hangs under its own start. */
  indent: number;
  tokens: { kind: TokenKind; text: string }[];
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?\b)/g;

/** Splits pretty-printed JSON into lines of coloured tokens. */
export function jsonLines(source: string): JsonLine[] {
  return source.split('\n').map((line) => {
    const indent = line.length - line.trimStart().length;
    const text = line.slice(indent);
    const tokens: JsonLine['tokens'] = [];
    let cursor = 0;
    for (const match of text.matchAll(TOKEN)) {
      const at = match.index ?? 0;
      if (at > cursor) tokens.push({ kind: 'plain', text: text.slice(cursor, at) });
      const [whole, quoted, colon, number] = match;
      if (quoted && colon) {
        tokens.push({ kind: 'key', text: quoted }, { kind: 'plain', text: colon });
      } else if (quoted) {
        tokens.push({ kind: 'string', text: quoted });
      } else if (number) {
        tokens.push({ kind: 'number', text: number });
      }
      cursor = at + whole.length;
    }
    if (cursor < text.length) tokens.push({ kind: 'plain', text: text.slice(cursor) });
    return { indent, tokens };
  });
}
