// Render endpoint test (HTML-based)
const MCP = 'https://bejewelled-llama-a6719d.netlify.app/mcp';
const RENDER = 'https://bejewelled-llama-a6719d.netlify.app/api/render';

async function mcp(method, params) {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return r.json();
}

async function main() {
  try {
    // 0. Quick check: is render endpoint alive?
    console.log('--- Checking render endpoint ---');
    const check = await fetch(RENDER + '/test_check');
    console.log('Endpoint status:', check.status);

    // 1. Create workspace
    console.log('\n--- Creating workspace ---');
    const ws = await mcp('tools/call', { name: 'create_workspace', arguments: { name: 'RenderTest_' + Date.now() } });
    const wsId = JSON.parse(ws.result.content[0].text).id;
    console.log('Workspace:', wsId);

    // 2. Create template with shapes
    console.log('\n--- Creating template ---');
    const objs = [
      { type: 'rect', left: 50, top: 50, width: 200, height: 150, fill: '#3B82F6', rx: 8, ry: 8 },
      { type: 'circle', left: 300, top: 100, radius: 80, fill: '#EF4444' },
      { type: 'text', left: 100, top: 350, text: 'Hello Futuraria!', fontSize: 48, fill: '#111827', fontFamily: 'Arial' },
    ];
    const tpl = await mcp('tools/call', { name: 'create_template', arguments: { name: 'Render Test', workspaceId: wsId, objects: objs } });
    const tplData = JSON.parse(tpl.result.content[0].text);
    console.log('Template:', tplData.id);

    // 3. Render via POST
    console.log('\n--- Rendering ---');
    const start = Date.now();
    const render = await fetch(RENDER + '/' + tplData.id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'png', scale: 1, template: tplData }),
    });
    const result = await render.json();
    const elapsed = Date.now() - start;

    if (render.status !== 200 || result.error) {
      console.log('❌ RENDER FAILED (status ' + render.status + '):', JSON.stringify(result).substring(0, 300));
    } else {
      console.log('✅ RENDER SUCCESS');
      console.log('  Status:', result.status);
      console.log('  JobId:', result.jobId);
      console.log('  Format:', result.format, '| Scale:', result.scale);
      console.log('  Dimensions:', result.width + 'x' + result.height);
      console.log('  HTML length:', result.html?.length || 0, 'chars');
      console.log('  View URL:', result._links?.view);
      console.log('  Total time:', elapsed + 'ms');

      // Verify HTML content
      if (result.html) {
        const hasHtml2canvas = result.html.includes('html2canvas.min.js');
        const hasRenderTarget = result.html.includes('id="render-target"');
        const hasDoCapture = result.html.includes('doCapture');
        console.log('  Has html2canvas CDN:', hasHtml2canvas);
        console.log('  Has render target:', hasRenderTarget);
        console.log('  Has doCapture:', hasDoCapture);
      }

      // 4. Test GET polling
      if (result.jobId && result._links?.view) {
        console.log('\n--- Testing GET poll ---');
        const poll = await fetch(RENDER + '/' + tplData.id + '/' + result.jobId);
        if (poll.ok) {
          const ct = poll.headers.get('content-type') || '';
          if (ct.includes('text/html')) {
            const html = await poll.text();
            console.log('  ✅ GET returns HTML (' + html.length + ' chars)');
            console.log('  Contains doCapture:', html.includes('doCapture'));
          } else {
            const pollJson = await poll.json();
            console.log('  Poll status:', pollJson.status);
          }
        } else {
          console.log('  ❌ GET failed (status ' + poll.status + ')');
        }
      }
    }

  } catch (e) {
    console.error('FATAL:', e.message);
    console.error(e.stack);
  }
}

main();
