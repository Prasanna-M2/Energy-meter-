const fs = require('fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const js = fs.readFileSync('public/app.js', 'utf8');

const htmlIcons = [...html.matchAll(/data-lucide=["']([^"']+)["']/g)].map(m => m[1]);
const jsIcons = [...js.matchAll(/data-lucide=["']([^"']+)["']/g)].map(m => m[1]);

const allIcons = [...new Set([...htmlIcons, ...jsIcons])].sort();
console.log('Total unique icons used:', allIcons.length);
console.log('Icon list:', allIcons);

// Search for any remaining references to 'gpt', 'sheet', 'google'
const files = [
  'public/index.html',
  'public/app.js',
  'server.js',
  'data/config.json'
];

console.log('\n--- SCANNING FOR UNWANTED STRINGS ---');
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.match(/gpt/i) || line.match(/google\s*sheet/i) || line.match(/google.*sheet/i)) {
      console.log(`[${file}:${idx + 1}] ${line.trim()}`);
    }
  });
}
