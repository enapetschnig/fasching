-- Fix infinite recursion in worker_assignments RLS policies
-- The old policies queried worker_assignments within their own USING clause

-- worker_assignments: vorarbeiter can manage all assignments
DROP POLICY IF EXISTS "vorarbeiter_manage_own_project_assignments" ON worker_assignments;
CREATE POLICY "vorarbeiter_manage_assignments" ON worker_assignments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
  );

-- project_daily_targets: vorarbeiter can manage all
DROP POLICY IF EXISTS "vorarbeiter_manage_project_daily_targets" ON project_daily_targets;
CREATE POLICY "vorarbeiter_manage_daily_targets" ON project_daily_targets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
  );

-- assignment_resources: vorarbeiter can manage all
DROP POLICY IF EXISTS "vorarbeiter_manage_assignment_resources" ON assignment_resources;
CREATE POLICY "vorarbeiter_manage_resources" ON assignment_resources
  FOR ALL USING (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid() AND position = 'vorarbeiter')
  );
