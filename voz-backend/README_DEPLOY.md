# Módulo de Voces — clones gratis (Chatterbox en Oracle A1)

## Qué falta (única pieza): la VM Oracle
sa-bogota-1 lleva SIN capacidad A1 desde el 17-nov. El retry loop corre en
Windows: `python C:/Users/Renzo/.oci/launch_musa_voz.py` (estado:
`~/.oci/musa_voz_launch_status.json`, instancia id en
`~/.oci/musa_voz_instance_id.txt`).

## Cuando la instancia salga (4 pasos, ~30 min)
1. `ssh -i ~/.oci/koro_vm_key ubuntu@<IP_PUBLICA>` (IP: consola OCI o
   `oci compute instance list-vnics --compartment-id <tenancy>`)
2. `scp -i ~/.oci/koro_vm_key -r musa-v2/voz-backend ubuntu@IP:~` y
   `ssh ... 'sudo bash ~/voz-backend/setup_voz_backend.sh'`
   - pegar el secret: `sudo sed -i "s/__SECRET__/$(cat ~/.oci/voz_backend_secret.txt)/" /etc/systemd/system/musa-voz.service && sudo systemctl restart musa-voz`
   - el script: build chatterbox.cpp (setup-ggml.sh + cmake), convierte GGUF
     MTL q4_0 (344MB + 685MB) desde HF, systemd en :8787
3. `cd musa-v2 && npx wrangler secret put VOZ_BACKEND_URL` → `http://IP:8787`
   (OAuth wrangler expira ~4h: cualquier comando wrangler lo refresca;
   deployar SIN las env vars CLOUDFLARE_* de b83f: `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npm run deploy:cloudflare`)
4. QA: crear voz sin key ElevenLabs → "clon Musa"; sintetizar → wav en ~RTF 1.0

## Verificado en prod (17-nov 20:47)
- worker v`637701ab` activo en musa-v2.renzo-08c.workers.dev
- VOZ_BACKEND_SECRET + R2_ACCOUNT_ID/ACCESS_KEY/SECRET en bindings
- bucket R2 musa-voz (08c) con lifecycle: voz-cache 24h, voz-samples 180d
- musa_voces + musa_voz_uso + rpc en prod y test (smoke ok)
- bridge-voces.js nuevo servido (fallback ELEVENLABS_KEY_MISSING → workers-ai)
- /api/musa-voz/* sin sesión → AUTH (routing nuevo activo)
