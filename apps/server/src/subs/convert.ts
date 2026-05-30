/**
 * Convert SubRip (.srt) text to WebVTT. Handles:
 *   - timestamp comma → period
 *   - removal of optional BOM
 *   - normalization of CRLF
 *   - stripping cue numbers (browsers ignore them; cleaner output)
 */
export function srtToVtt(src: string): string {
  let text = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  text = text.replace(
    /(\d{1,2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4',
  );
  // strip pure-numeric cue lines that immediately precede a timestamp line
  text = text.replace(/(^|\n)\d+\n(?=\d{1,2}:\d{2}:\d{2}\.\d{3} --> )/g, '$1');
  if (!text.startsWith('WEBVTT')) text = `WEBVTT\n\n${text.trim()}\n`;
  return text;
}
