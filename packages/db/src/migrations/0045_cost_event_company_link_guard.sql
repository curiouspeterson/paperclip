CREATE OR REPLACE FUNCTION cost_events_assert_company_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.issue_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM issues
    WHERE id = NEW.issue_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Cost event issue must belong to the same company'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM projects
    WHERE id = NEW.project_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Cost event project must belong to the same company'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM goals
    WHERE id = NEW.goal_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Cost event goal must belong to the same company'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.heartbeat_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM heartbeat_runs
    WHERE id = NEW.heartbeat_run_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Cost event heartbeat run must belong to the same company'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS cost_events_company_links_guard ON cost_events;
--> statement-breakpoint
CREATE TRIGGER cost_events_company_links_guard
  BEFORE INSERT OR UPDATE OF company_id, issue_id, project_id, goal_id, heartbeat_run_id
  ON cost_events
  FOR EACH ROW
  EXECUTE FUNCTION cost_events_assert_company_links();
