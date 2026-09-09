import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'birdie-course-'));
const files = ['shot-engine', 'course-flight', 'course-scene'];
try {
  execFileSync('tsc', ['--target','ES2022','--module','commonjs','--strict','--lib','ES2022,DOM','--rewriteRelativeImportExtensions', '--rootDir','src/features/game','--outDir',temp, ...files.map(f=>`src/features/game/${f}.ts`)], {cwd:root,stdio:'inherit'});
  let script = '(() => {const modules=Object.create(null),cache=Object.create(null);\n';
  for (const name of files) script += `modules[${JSON.stringify('./'+name+'.js')}]=function(module,exports,require){\n${readFileSync(join(temp,name+'.js'),'utf8')}\n};\n`;
  script += 'function require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw Error("Unknown preview module");const m={exports:{}};cache[id]=m;modules[id](m,m.exports,require);return m.exports;}\nwindow.CoursePreviewModules={...require("./shot-engine.js"),...require("./course-flight.js"),...require("./course-scene.js")};})();';
  const template=readFileSync(join(root,'preview/course-preview.html'),'utf8');
  if (!template.includes('/* COURSE_BUNDLE */')) throw Error('Preview bundle marker missing');
  const html=template.replace('/* COURSE_BUNDLE */',()=>script.replace(/<\/script/gi,'<\\/script'));
  mkdirSync(join(root,'dist-course'),{recursive:true});
  writeFileSync(join(root,'dist-course/BirdieWorld_Course_Flight_v1.html'),html);
  console.log('Built dist-course/BirdieWorld_Course_Flight_v1.html (offline; no server, no deployment)');
} finally { rmSync(temp,{recursive:true,force:true}); }
