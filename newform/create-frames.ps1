$workspaceId = "ws_0e3002d1-c5a"
$mcp = "https://bejewelled-llama-a6719d.netlify.app/mcp"

$body = (@{ jsonrpc="2.0"; id=1; method="tools/call"; params=@{ name="create_html_template"; arguments=@{ name="ADISruptive - Futuraria (NewForm Style)"; workspaceId=$workspaceId; width=1080; height=1080 }}} | ConvertTo-Json -Depth 3 -Compress)
$resp = Invoke-RestMethod -Uri $mcp -Method POST -ContentType "application/json" -Body $body
$templateId = ($resp.result.content[0].text | ConvertFrom-Json).id
Write-Host "Template: $templateId"

# NewForm-style CSS with custom tokens, substituting fonts for available ones
$newformCSS = @"
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@0,200;0,300;0,400;0,500;0,600;0,700&display=swap');
:root{
--linen:#fafffa;--obsidian:#121613;--black:#000;--bark:#232924;--sage:#516254;--mist:#c8d2c8;--voltage:#2bee4b;--moss:#93b799;--pollen:#c4e4c9;
--font-display:'Playfair Display',Georgia,serif;--font-ui:'Inter',system-ui,sans-serif;--font-caption:Georgia,'Times New Roman',serif;
--shadow-cta:rgba(16,94,29,0.45) 1px 8px 20px 0px,rgba(18,146,39,0.25) 1px 8px 20px 0px;
--radius-img:14px;--radius-btn:10px;
}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1080px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--linen)}
.post{width:1080px;height:1080px;background:var(--linen);position:relative;overflow:hidden;display:flex;flex-direction:column}
/* Masthead */
.masthead{display:flex;justify-content:space-between;align-items:center;padding:44px 56px 0}
.wordmark{font-family:var(--font-ui);font-size:14px;font-weight:550;letter-spacing:-0.01em}
.wordmark .new{color:var(--obsidian)}
.wordmark .form{color:var(--voltage)}
.menu-label{font-family:var(--font-ui);font-size:14px;font-weight:350;color:var(--obsidian)}
.green-mark{display:inline-block;width:12px;height:12px;margin-left:8px;position:relative}
.green-mark::before,.green-mark::after{content:'';position:absolute;top:0;width:2px;height:12px;background:var(--voltage)}
.green-mark::before{left:2px}.green-mark::after{right:2px}
/* Hero display */
.hero{padding:64px 56px 32px;flex:1;display:flex;flex-direction:column}
.hero h1{font-family:var(--font-display);font-weight:400;font-size:72px;line-height:0.9;letter-spacing:-0.02em;color:var(--obsidian);margin-bottom:24px}
.hero h1 .italic{font-style:italic}
.hero h1 .voltage-word{color:var(--voltage);font-style:italic}
.tick{width:56px;height:2px;background:var(--voltage);margin-bottom:28px}
.body-text{font-family:var(--font-ui);font-weight:350;font-size:16px;line-height:1.5;color:var(--sage);max-width:520px;margin-bottom:12px}
.body-text strong{color:var(--obsidian);font-weight:550}
/* Event details strip */
.details{display:flex;gap:40px;margin-top:auto;padding:0 56px 20px}
.detail-item{display:flex;flex-direction:column;gap:2px}
.detail-label{font-family:var(--font-ui);font-size:11px;font-weight:550;text-transform:uppercase;letter-spacing:0.08em;color:var(--sage)}
.detail-value{font-family:var(--font-ui);font-size:14px;font-weight:400;color:var(--obsidian)}
/* Footer bar */
.footer-bar{display:flex;justify-content:space-between;align-items:center;padding:24px 56px 40px;border-top:1px solid var(--mist)}
.footer-bar .caption{font-family:var(--font-caption);font-size:16px;font-style:italic;color:var(--sage)}
.cta{display:inline-flex;align-items:center;gap:8px;background:var(--voltage);color:var(--black);font-family:var(--font-ui);font-size:14px;font-weight:550;text-transform:uppercase;letter-spacing:0.01em;padding:14px 36px;border-radius:var(--radius-btn);box-shadow:var(--shadow-cta);text-decoration:none}
.cta .arrow{font-size:16px}
/* Decorative voltage tick */
.vtick{position:absolute;width:40px;height:2px;background:var(--voltage)}
.vtick.top-right{top:100px;right:56px}
.vtick.bottom-right{bottom:130px;right:56px}
/* B&W ornamental circle */
.ornament{position:absolute;width:120px;height:120px;border-radius:50%;background:var(--black);bottom:100px;right:56px;opacity:0.06}
"@

$html = @"
<div class="post">
  <div class="vtick top-right"></div>
  <div class="vtick bottom-right"></div>
  <div class="ornament"></div>

  <div class="masthead">
    <div class="wordmark"><span class="new">Futur</span><span class="form">aria</span></div>
    <div><span class="menu-label">ADISruptive<span class="green-mark"></span></span></div>
  </div>

  <div class="hero">
    <h1>Design<br>Engineers<span class="italic">.</span><br><span class="voltage-word">Espa&ntilde;a</span></h1>
    <div class="tick"></div>
    <p class="body-text"><strong>Futuraria se presenta en ADISruptive</strong> — el congreso donde el dise&ntilde;o se encuentra con la inteligencia artificial. Una conversaci&oacute;n sobre el perfil h&iacute;brido que las organizaciones necesitan.</p>
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
    <a class="cta">Conocer m&aacute;s <span class="arrow">&rarr;</span></a>
  </div>
</div>
"@

$args = @{ templateId=$templateId; name="ADISruptive Post"; html=$html; css=$newformCSS; width=1080; height=1080; background="#fafffa" }
$body = @{ jsonrpc="2.0"; id=1; method="tools/call"; params=@{ name="create_html_frame"; arguments=$args } }
$json = $body | ConvertTo-Json -Depth 5 -Compress
$resp = Invoke-RestMethod -Uri $mcp -Method POST -ContentType "application/json" -Body $json
$data = $resp.result.content[0].text | ConvertFrom-Json
Write-Host "Created: $($data.name) ($($data.id))"