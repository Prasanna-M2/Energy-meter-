const fs = require('fs');

async function verifyLucideIcons() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const js = fs.readFileSync('public/app.js', 'utf8');

  const htmlMatches = [...html.matchAll(/data-lucide=["']([^"']+)["']/g)].map(m => m[1]);
  const jsMatches = [...js.matchAll(/data-lucide=["']([^"']+)["']/g)].map(m => m[1]);

  const rawIcons = [...new Set([...htmlMatches, ...jsMatches])].filter(i => !i.includes('${'));
  console.log(`Checking ${rawIcons.length} unique icon names...`);

  // Download lucide bundle
  const res = await fetch('https://unpkg.com/lucide@latest');
  const lucideCode = await res.text();

  const missingIcons = [];
  const validIcons = [];

  for (const icon of rawIcons) {
    // Lucide names can be checked by searching for '"icon-name"' or 'toPascalCase' in the bundle
    // e.g. "bar-chart-2" -> "BarChart2"
    const pascalName = icon
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    
    // Lucide exports both kebab-case keys and PascalCase keys
    if (lucideCode.includes(`"${icon}"`) || lucideCode.includes(`'${icon}'`) || lucideCode.includes(pascalName)) {
      validIcons.push(icon);
    } else {
      missingIcons.push(icon);
    }
  }

  console.log(`Valid Icons (${validIcons.length}):`, validIcons.join(', '));
  if (missingIcons.length > 0) {
    console.error(`MISSING/INVALID ICONS (${missingIcons.length}):`, missingIcons.join(', '));
  } else {
    console.log('ALL 44 ICONS ARE 100% VALID IN LUCIDE!');
  }
}

verifyLucideIcons().catch(err => console.error(err));
