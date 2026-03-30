-- ============================================================
-- Plantafel Redesign: company_holidays + Vorarbeiter RLS
-- ============================================================

-- 1) Betriebsurlaub-Tabelle
CREATE TABLE IF NOT EXISTS company_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datum DATE NOT NULL UNIQUE,
  bezeichnung TEXT DEFAULT 'Betriebsurlaub',
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE company_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_company_holidays" ON company_holidays
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'administrator')
  );

CREATE POLICY "auth_read_company_holidays" ON company_holidays
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_company_holidays_datum ON company_holidays(datum);

-- 2) Vorarbeiter RLS: worker_assignments lesen
CREATE POLICY "vorarbeiter_read_all_assignments" ON worker_assignments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
  );

-- 3) Vorarbeiter RLS: worker_assignments eigene Projekte verwalten
CREATE POLICY "vorarbeiter_manage_own_project_assignments" ON worker_assignments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
    AND EXISTS (
      SELECT 1 FROM worker_assignments wa2
      WHERE wa2.user_id = auth.uid() AND wa2.project_id = worker_assignments.project_id
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
    AND EXISTS (
      SELECT 1 FROM worker_assignments wa2
      WHERE wa2.user_id = auth.uid() AND wa2.project_id = worker_assignments.project_id
    )
  );

-- 4) Vorarbeiter RLS: project_daily_targets eigene Projekte
CREATE POLICY "vorarbeiter_manage_project_daily_targets" ON project_daily_targets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
    AND EXISTS (
      SELECT 1 FROM worker_assignments WHERE user_id = auth.uid() AND project_id = project_daily_targets.project_id
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
    AND EXISTS (
      SELECT 1 FROM worker_assignments WHERE user_id = auth.uid() AND project_id = project_daily_targets.project_id
    )
  );

-- 5) Vorarbeiter RLS: assignment_resources eigene Projekte
CREATE POLICY "vorarbeiter_manage_assignment_resources" ON assignment_resources
  FOR ALL USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
    AND EXISTS (
      SELECT 1 FROM worker_assignments WHERE user_id = auth.uid() AND project_id = assignment_resources.project_id
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
    AND EXISTS (
      SELECT 1 FROM worker_assignments WHERE user_id = auth.uid() AND project_id = assignment_resources.project_id
    )
  );
