// Składa gotową stronę: szablon src/app.html + dane mapy z build/map.json.
//   node assemble.js            -> azja/index.html (samodzielny plik HTML)
//   node assemble.js frag.html  -> dodatkowo sam fragment strony (bez <html>/<head>)
const fs = require('fs');
const path = require('path');

const map = fs.readFileSync(path.join(__dirname, 'map.json'), 'utf8');
const tpl = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.html'), 'utf8');
const page = tpl.replace('/*MAPDATA*/null', () => map);
if (page === tpl) throw new Error('Brak znacznika /*MAPDATA*/ w szablonie');

const cut = page.indexOf('</style>') + '</style>'.length;
const html = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${page.slice(0, cut)}
</head>
<body>
${page.slice(cut).trim()}
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, '..', 'index.html'), html);
if (process.argv[2]) fs.writeFileSync(process.argv[2], page);
console.log('index.html', (html.length / 1024).toFixed(0) + ' KB');
