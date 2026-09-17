const fs = require('fs');
const path = require('path');
const pjson = require('./package.json');
const deps = Object.keys(pjson.dependencies);

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('./src');
files.push('./App.tsx');
files.push('./index.ts');

const notFound = new Set();
files.forEach(f => {
  const content = fs.readFileSync(f, 'utf-8');
  const importRegex = /import .* from ['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const pkg = match[1];
    if (pkg.startsWith('.')) continue; // local import
    if (pkg === 'react' || pkg === 'react-native') continue;
    const isBuiltIn = deps.some(d => pkg.startsWith(d) || pkg === d);
    if (!isBuiltIn) notFound.add(pkg);
  }
});
console.log('Missing deps:', Array.from(notFound));
