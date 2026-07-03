import https from 'https';

function mcpCall(method, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: method, arguments: args }, id: 1 });
    const url = new URL('https://design.futuraria.com/mcp');
    const opts = { hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); } }); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseResult(res) {
  if (res.error) throw new Error(res.error.message);
  const text = res.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : res.result;
}

// IDs from setup
const TPL_ID = 'tpl_af746216-351';
const FRAME_ID = 'frame_4f8834c3-68f';

async function main() {
  let allPassed = 0;
  let allFailed = 0;
  
  function check(label, condition) {
    if (condition) { console.log(`  ✓ ${label}`); allPassed++; }
    else { console.log(`  ✗ FAIL: ${label}`); allFailed++; }
  }

  try {
    // ===== TEST 1: generate_design_artifacts (extract mode) =====
    console.log('\n=== TEST 1: generate_design_artifacts (extract) ===');
    const gen1 = parseResult(await mcpCall('generate_design_artifacts', {
      templateId: TPL_ID,
      action: 'extract'
    }));
    console.log('Keys:', Object.keys(gen1).join(', '));
    console.log('Extraction keys:', Object.keys(gen1.extraction || {}).join(', '));
    check('Has sourceHash', !!gen1.extraction?.sourceHash);
    check('Has colors', Array.isArray(gen1.extraction?.colors));
    check('Has typography', typeof gen1.extraction?.typography === 'object');
    check('Has spacing', typeof gen1.extraction?.spacing === 'object');
    check('Has components', Array.isArray(gen1.extraction?.components));
    check('Has images', Array.isArray(gen1.extraction?.images));
    console.log('Colors found:', JSON.stringify(gen1.extraction?.colors));
    console.log('Typography:', JSON.stringify(gen1.extraction?.typography));

    // ===== TEST 2: generate_design_artifacts (generate mode) =====
    console.log('\n=== TEST 2: generate_design_artifacts (generate) ===');
    const gen2 = parseResult(await mcpCall('generate_design_artifacts', {
      templateId: TPL_ID,
      action: 'generate'
    }));
    console.log('Keys:', Object.keys(gen2).join(', '));
    check('Has designMd', typeof gen2.designMd === 'string' && gen2.designMd.length > 0);
    check('Has tokensJson', typeof gen2.tokensJson === 'string' && gen2.tokensJson.length > 0);
    check('Has sharedCss', typeof gen2.sharedCss === 'string' && gen2.sharedCss.length > 0);
    check('Has sourceHash', !!gen2.sourceHash);
    check('Is deterministic', gen2._deterministic === true || gen2.extraction !== undefined);
    console.log('DESIGN.md preview (first 200 chars):');
    console.log(gen2.designMd.substring(0, 200));
    console.log('...');
    console.log('Tokens JSON preview (first 200 chars):');
    console.log(gen2.tokensJson.substring(0, 200));
    console.log('...');

    // ===== TEST 2b: DETERMINISM VERIFICATION =====
    console.log('\n=== TEST 2b: DETERMINISM VERIFICATION (run extraction twice) ===');
    const gen2b = parseResult(await mcpCall('generate_design_artifacts', {
      templateId: TPL_ID,
      action: 'generate'
    }));
    check('DesignMd identical (deterministic)', gen2.designMd === gen2b.designMd);
    check('TokensJson identical (deterministic)', gen2.tokensJson === gen2b.tokensJson);
    check('SharedCss identical (deterministic)', gen2.sharedCss === gen2b.sharedCss);
    check('SourceHash identical', gen2.sourceHash === gen2b.sourceHash);

    // ===== TEST 3: generate_design_artifacts (publish mode) =====
    console.log('\n=== TEST 3: generate_design_artifacts (publish) ===');
    const gen3 = parseResult(await mcpCall('generate_design_artifacts', {
      templateId: TPL_ID,
      action: 'publish'
    }));
    check('Published', gen3._published === true);
    check('Has designMd when published', typeof gen3.designMd === 'string');
    check('Has sourceHash when published', !!gen3.sourceHash);

    // ===== TEST 4: get_design_artifacts =====
    console.log('\n=== TEST 4: get_design_artifacts ===');
    const get4 = parseResult(await mcpCall('get_design_artifacts', {
      templateId: TPL_ID
    }));
    console.log('Keys:', Object.keys(get4).join(', '));
    check('Returns designMd', typeof get4.designMd === 'string' && get4.designMd.length > 0);
    check('Returns tokensJson', typeof get4.tokensJson === 'string');
    check('Returns sharedCss', typeof get4.sharedCss === 'string');
    check('Has sourceHash', !!get4.sourceHash);
    check('Has _stale flag', typeof get4._stale === 'boolean');
    check('Artifacts NOT stale (just published)', get4._stale === false);

    // ===== TEST 5: duplicate_frame =====
    console.log('\n=== TEST 5: duplicate_frame ===');
    const dup5 = parseResult(await mcpCall('duplicate_frame', {
      templateId: TPL_ID,
      sourceFrameId: FRAME_ID,
      newName: 'Cloned Hero'
    }));
    console.log(JSON.stringify(dup5, null, 2));
    const dupFrameId = dup5.frameId || dup5.id;
    check('Returns frameId', !!dupFrameId);
    check('Returns contentHash', !!dup5.contentHash);
    check('Different frameId', dupFrameId !== FRAME_ID);

    // ===== TEST 6: update_frame_content (surgical editing, one selector at a time) =====
    console.log('\n=== TEST 6: update_frame_content ===');
    
    // Patch 1: title
    const up6a = parseResult(await mcpCall('update_frame_content', {
      templateId: TPL_ID, frameId: dupFrameId,
      selector: 'h1.title', patch: { text: 'Updated Title!' }
    }));
    console.log('Patch 1:', JSON.stringify(up6a));
    check('Patch1 matched >=1', up6a.matched >= 1);
    
    // Patch 2: description
    const up6b = parseResult(await mcpCall('update_frame_content', {
      templateId: TPL_ID, frameId: dupFrameId,
      selector: 'p.desc', patch: { text: 'This was surgically edited.' }
    }));
    check('Patch2 matched >=1', up6b.matched >= 1);
    
    // Patch 3: button
    const up6c = parseResult(await mcpCall('update_frame_content', {
      templateId: TPL_ID, frameId: dupFrameId,
      selector: 'button.cta', patch: { text: 'BUY NOW', style: { background: '#ef4444' } }
    }));
    check('Patch3 matched >=1', up6c.matched >= 1);
    
    // Patch 4: image
    const up6d = parseResult(await mcpCall('update_frame_content', {
      templateId: TPL_ID, frameId: dupFrameId,
      selector: 'img.hero-img', patch: { src: 'https://picsum.photos/600/400' }
    }));
    check('Patch4 matched >=1', up6d.matched >= 1);
    
    // Final verification: re-fetch frame
    const tplFinal = parseResult(await mcpCall('get_template', { id: TPL_ID }));
    const finalFrame = (tplFinal.frames || []).find(f => f.id === dupFrameId);
    const finalHtml = finalFrame ? (finalFrame.html || '') : '';
    check('Final HTML contains "Updated Title!"', finalHtml.includes('Updated Title!'));
    check('Final HTML contains "surgically edited"', finalHtml.includes('surgically edited'));
    check('Final HTML contains "BUY NOW"', finalHtml.includes('BUY NOW'));
    check('Final HTML contains new image URL', finalHtml.includes('picsum.photos/600/400'));

    // ===== TEST 7: get_frame_changes =====
    console.log('\n=== TEST 7: get_frame_changes ===');
    const chg7 = parseResult(await mcpCall('get_frame_changes', {
      templateId: TPL_ID
    }));
    console.log(JSON.stringify(chg7, null, 2));
    check('Returns changes array', Array.isArray(chg7.changes));
    check('Returns sourceHash', !!chg7.sourceHash);
    check('Has sourceChanged flag', typeof chg7.sourceChanged === 'boolean');
    const origChange = (chg7.changes || []).find(c => c.frameId === FRAME_ID);
    const dupChange = (chg7.changes || []).find(c => c.frameId === dupFrameId);
    check('Original frame in changes', !!origChange);
    check('Cloned frame in changes', !!dupChange);
    if (origChange) check('Original has lastModifiedBy', !!origChange.lastModifiedBy);
    if (dupChange) check('Clone has lastModifiedBy', !!dupChange.lastModifiedBy);

    // ===== TEST 7b: get_frame_changes with sinceSourceHash =====
    console.log('\n=== TEST 7b: get_frame_changes (with sinceSourceHash) ===');
    const chg7b = parseResult(await mcpCall('get_frame_changes', {
      templateId: TPL_ID,
      sinceSourceHash: gen2.sourceHash
    }));
    console.log(JSON.stringify(chg7b, null, 2));
    check('Has changes array', Array.isArray(chg7b.changes));
    check('Has knownSourceHash', typeof chg7b.knownSourceHash === 'string');
    check('Has sourceChanged flag', typeof chg7b.sourceChanged === 'boolean');

    // ===== SUMMARY =====
    console.log(`\n========================================`);
    console.log(`  RESULTS: ${allPassed} passed, ${allFailed} failed`);
    console.log(`  RATE: ${Math.round(allPassed / (allPassed + allFailed) * 100)}%`);
    console.log(`========================================`);

  } catch(e) { 
    console.error('TEST ERROR:', e.message, e.stack); 
  }
}
main();
