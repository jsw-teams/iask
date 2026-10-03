import {rm} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyWidgetAssets} from './assets.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,'dist');
if(relative(root,output)!=='dist')throw new Error('Unsafe generated output path');
// This command owns only this project's fixed generated dist directory.
await rm(output,{recursive:true,force:true});
await copyWidgetAssets(output);
