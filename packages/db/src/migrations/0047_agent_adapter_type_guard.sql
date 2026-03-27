DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_adapter_type_check'
      AND conrelid = 'agents'::regclass
  ) THEN
    ALTER TABLE "agents"
      ADD CONSTRAINT "agents_adapter_type_check"
      CHECK (
        "adapter_type" IN (
          'process',
          'http',
          'claude_local',
          'codex_local',
          'gemini_local',
          'opencode_local',
          'pi_local',
          'cursor',
          'openclaw_gateway',
          'hermes_local'
        )
      ) NOT VALID;
  END IF;
END $$;
