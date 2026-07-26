-- Allow anon role to manage webhooks (needed for client-side UI)
CREATE POLICY "Allow all for anon" ON webhooks FOR ALL TO anon USING (true);
