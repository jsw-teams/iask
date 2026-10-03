import {cp, mkdir, rm, readFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {copyWidgetAssets} from './assets.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--website-source'))throw new Error('Usage: node tools/build-site.mjs [--website-source <EdgePress checkout>]');
const website=resolve(args[1] || process.env.IASK_WEBSITE_DIR || resolve(root,'../web/js.gripe'));
const metadata=JSON.parse(await readFile(resolve(website,'package.json'),'utf8'));
if(metadata.name!=='js-gripe')throw new Error('Production requires the JS.GRIPE static website checkout');
const build=spawnSync(process.execPath,['src/cli.js','build'],{cwd:website,stdio:'inherit'});
if(build.error)throw build.error;
if(build.status!==0)process.exit(build.status || 1);
const output=resolve(root,'dist');
const within=relative(root,output);
if(within!=='dist' || isAbsolute(within) || output===website || output===resolve(website,'dist'))throw new Error('Unsafe generated output path');
// Only the checked, project-owned generated directory is replaced.
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(resolve(website,'dist'),output,{recursive:true});
await copyWidgetAssets(output,{preserveHeaders:true});
console.log('Built iAsk backend assets with the static JS.GRIPE website.');
