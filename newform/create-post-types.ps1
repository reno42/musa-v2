$workspaceId = "ws_0e3002d1-c5a"
$mcp = "https://bejewelled-llama-a6719d.netlify.app/mcp"
$templateId = "tpl_87c146ed-212"

$newformCSS = @"
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Inter:wght@0,300;0,400;0,500;0,600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1080px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#fafffa}
.post{width:1080px;height:1080px;background:#fafffa;position:relative;overflow:hidden;display:flex;flex-direction:column}
.masthead{display:flex;justify-content:space-between;align-items:center;padding:44px 56px 0}
.wordmark{font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:-0.01em}
.wordmark .n{color:#121613}
.wordmark .f{color:#2bee4b}
.menu-label{font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:400;color:#121613}
.green-mark{display:inline-block;width:12px;height:12px;margin-left:8px;position:relative;vertical-align:middle}
.green-mark::before,.green-mark::after{content:'';position:absolute;top:0;width:2px;height:12px;background:#2bee4b}
.green-mark::before{left:2px}.green-mark::after{right:2px}
.hero{padding:72px 56px 32px;flex:1;display:flex;flex-direction:column}
.hero h1{font-family:Playfair Display,Georgia,serif;font-weight:400;font-size:82px;line-height:0.88;letter-spacing:-0.02em;color:#121613;margin-bottom:20px}
.hero h1 .italic{font-style:italic}
.hero h1 .vw{color:#2bee4b;font-style:italic}
.tick{width:56px;height:2px;background:#2bee4b;margin-bottom:28px}
.body-text{font-family:Inter,system-ui,sans-serif;font-weight:350;font-size:16px;line-height:1.5;color:#516254;max-width:560px;margin-bottom:12px}
.body-text strong{color:#121613;font-weight:550}
.details{display:flex;gap:44px;margin-top:auto;padding:0 56px 20px}
.detail-item{display:flex;flex-direction:column;gap:4px}
.detail-label{font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#516254}
.detail-value{font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:400;color:#121613}
.footer-bar{display:flex;justify-content:space-between;align-items:center;padding:24px 56px 40px;border-top:1px solid #c8d2c8}
.footer-bar .caption{font-family:Georgia,Times New Roman,serif;font-size:16px;font-style:italic;color:#516254}
.cta{display:inline-flex;align-items:center;gap:8px;background:#2bee4b;color:#000;font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.01em;padding:14px 36px;border-radius:10px;box-shadow:rgba(16,94,29,0.45) 1px 8px 20px 0px,rgba(18,146,39,0.25) 1px 8px 20px 0px}
.cta .arr{font-size:16px}
.vtick{position:absolute;width:40px;height:2px;background:#2bee4b}
.vt{top:100px;right:56px}
.vb{bottom:130px;right:56px}
.orn{position:absolute;width:120px;height:120px;border-radius:50%;background:#000;bottom:100px;right:56px;opacity:0.05}
"@

$html = @'
<div class="post">
  <div class="vtick vt"></div>
  <div class="vtick vb"></div>
  <div class="orn"></div>

  <div class="masthead">
    <div class="wordmark"><span class="n">Futur</span><span class="f">aria</span></div>
    <div><span class="menu-label">ADISruptive<span class="green-mark"></span></span></div>
  </div>

  <div class="hero">
    <h1>Design<br>Engineers<span class="italic">.</span><br><span class="vw">Espa&ntilde;a</span></h1>
    <div class="tick"></div>
    <p class="body-text"><strong>Futuraria se presenta en ADISruptive</strong> &mdash; el congreso donde el dise&ntilde;o se encuentra con la inteligencia artificial. Una conversaci&oacute;n sobre el perfil h&iacute;brido que las organizaciones necesitan.</p>
    <p class="body-text">Dirigido por <strong>Jorge S&aacute;nchez</strong>. Una persona. Cuatro agentes de IA. Un estudio completo.</p>

    <div class="details">
      <div class="detail-item">
        <span class="detail-label">Ponente</span>
        <span class="detail-value">Renzo P&eacute;rez Bartra</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Director</span>
        <span class="detail-value">Jorge S&aacute;nchez</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Evento</span>
        <span class="detail-value">ADISruptive 2026</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Lugar</span>
        <span class="detail-value">Espa&ntilde;a</span>
      </div>
    </div>
  </div>

  <div class="footer-bar">
    <span class="caption">El perfil h&iacute;brido que las organizaciones necesitan.</span>
    <a class="cta">Conocer m&aacute;s <span class="arr">&rarr;</span></a>
  </div>
</div>
'@

$args = @{ templateId=$templateId; name="ADISruptive - Futuraria"; html=$html; css=$newformCSS; width=1080; height=1080; background="#fafffa" }
$body = @{ jsonrpc="2.0"; id=1; method="tools/call"; params=@{ name="create_html_frame"; arguments=$args } }
$json = $body | ConvertTo-Json -Depth 5 -Compress
try {
    $resp = Invoke-RestMethod -Uri $mcp -Method POST -ContentType "application/json" -Body $json
    $data = $resp.result.content[0].text | ConvertFrom-Json
    Write-Host "OK: $($data.name) ($($data.id))"
} catch {
    Write-Host "FAIL: $_"
    Write-Host "Response: $($_.Exception.Response)"
}