import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
const require=createRequire(import.meta.url);
let ts;
try { ts=require('typescript'); } catch { ts=require(resolve(execSync('npm root -g',{encoding:'utf8'}).trim(),'typescript')); }
const files=['src/components/EmeraldWorldSkin.tsx','src/components/EmeraldShotMotion.tsx','src/components/EmeraldWorldPass05Skin.tsx','src/features/game/GameApp.tsx','src/features/game/CourseScene.tsx'];
const findings=files.map(file=>{
 const source=readFileSync(file,'utf8');
 const result=ts.transpileModule(source,{fileName:file,compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 const errors=(result.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n'));
 return {file,pass:errors.length===0,errors};
});
console.log(JSON.stringify({scope:'TSX syntax, not full React typecheck or mounted-host test',findings},null,2));
if(findings.some(f=>!f.pass))process.exitCode=1;
