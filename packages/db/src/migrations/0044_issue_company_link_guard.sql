CREATE OR REPLACE FUNCTION issues_assert_company_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM projects
    WHERE id = NEW.project_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Issue project must belong to the same company'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM goals
    WHERE id = NEW.goal_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Issue goal must belong to the same company'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM issues
    WHERE id = NEW.parent_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Issue parent must belong to the same company'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1
   FROM pg_trigger
   WHERE tgname = 'issues_company_links_guard'
 ) THEN
  CREATE TRIGGER issues_company_links_guard
    BEFORE INSERT OR UPDATE OF company_id, project_id, goal_id, parent_id
    ON issues
    FOR EACH ROW
    EXECUTE FUNCTION issues_assert_company_links();
 END IF;
END $$;
