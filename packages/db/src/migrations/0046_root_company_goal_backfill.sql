INSERT INTO "goals" (
  "company_id",
  "title",
  "description",
  "level",
  "status",
  "parent_id",
  "created_at",
  "updated_at"
)
SELECT
  "companies"."id",
  "companies"."name",
  "companies"."description",
  'company',
  'planned',
  NULL,
  "companies"."created_at",
  "companies"."updated_at"
FROM "companies"
WHERE NOT EXISTS (
  SELECT 1
  FROM "goals"
  WHERE "goals"."company_id" = "companies"."id"
    AND "goals"."level" = 'company'
    AND "goals"."parent_id" IS NULL
);
