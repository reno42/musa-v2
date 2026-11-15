-- RLS para formularios publicos de musa-v2 (MusaTest lnbsmnbvclxrwwcuuvud)
-- bug_reports: cualquiera reporta (anon insert), nadie edita ni borra desde el navegador.
-- El staff edita/borra desde el server (secret key, que bypasea RLS).
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bug_reports_public_insert ON bug_reports;
CREATE POLICY bug_reports_public_insert ON bug_reports FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS bug_reports_staff_read ON bug_reports;
CREATE POLICY bug_reports_staff_read ON bug_reports FOR SELECT TO authenticated USING (true);
-- waitlist_entries: insert publico del landing, el resto solo staff.
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waitlist_public_insert ON waitlist_entries;
CREATE POLICY waitlist_public_insert ON waitlist_entries FOR INSERT TO anon, authenticated WITH CHECK (true);
