#!/usr/bin/env node
import {copyWidgetAssets} from './assets.mjs';
if(process.argv[2]!=='assets' || !process.argv[3])throw new Error('Usage: iask assets <site-output-directory>');
await copyWidgetAssets(process.argv[3]);
