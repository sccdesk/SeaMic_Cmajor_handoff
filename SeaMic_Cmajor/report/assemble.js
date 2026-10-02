// Assemble report/SeaTime_DSP_Report.html from pNN.html parts.
// Done in Node on purpose: Windows PowerShell 5.1 Get-Content reads BOM-less UTF-8
// files as the ANSI codepage, which double-encodes every accent/em dash (the reason the
// first PDF build showed "â€”" instead of "—"). Node always decodes UTF-8 correctly.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const parts = fs
  .readdirSync(dir)
  .filter((f) => /^p\d+\.html$/.test(f))
  .sort();

if (parts.length === 0) throw new Error('no pNN.html parts found in ' + dir);

const chunks = [];
const nonAscii = new Set();
for (const f of parts) {
  const buf = fs.readFileSync(path.join(dir, f));
  // strict UTF-8 validation: throws on invalid byte sequences instead of silently corrupting
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  for (const ch of text) if (ch.charCodeAt(0) > 126) nonAscii.add(ch);
  chunks.push(text);
}

const html = chunks.join('\n');
const out = path.join(dir, 'SeaTime_DSP_Report.html');
fs.writeFileSync(out, html, { encoding: 'utf8' }); // UTF-8, no BOM; matches <meta charset="utf-8">

const mojibake = ['â€', 'Ã', 'Â'].filter((m) => html.includes(m));
console.log(
  JSON.stringify({
    parts: parts.length,
    bytes: Buffer.byteLength(html),
    nonAsciiChars: [...nonAscii].sort().join(' '),
    mojibakeMarkers: mojibake,
    hasMetaCharset: /<meta\s+charset=/i.test(html),
    openBodyTags: (html.match(/<body/gi) || []).length,
    closeHtmlTags: (html.match(/<\/html>/gi) || []).length,
  })
);
