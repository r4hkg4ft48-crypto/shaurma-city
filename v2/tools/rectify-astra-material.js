#!/usr/bin/env node
'use strict';
// node v2/tools/rectify-astra-material.js package.json crop-spec.json material.json
// spec: {id,source_asset_id,source_quad:[[TL],[TR],[BR],[BL]],width:512,height:512}
const fs=require('fs');const {rectify}=require('../backend/src/realcity-material');
(async()=>{
 const [packagePath,specPath,outPath]=process.argv.slice(2);if(!outPath)throw new Error('Usage: package.json crop-spec.json material.json');
 const pkg=JSON.parse(fs.readFileSync(packagePath)),spec=JSON.parse(fs.readFileSync(specPath));
 const asset=pkg.assets.find(x=>x.id===spec.source_asset_id);if(!asset)throw new Error('reference_not_found');
 const data_url=await rectify(asset.src,spec.source_quad,spec.width||512,spec.height||512);
 fs.writeFileSync(outPath,JSON.stringify({id:spec.id,source_asset_id:asset.id,source_quad:spec.source_quad,rectified:true,data_url},null,2));
 console.log('Rectified material written');
})().catch(e=>{console.error(e.message);process.exitCode=1});
