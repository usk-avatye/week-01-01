LOCK TABLE campaigns, executions IN SHARE ROW EXCLUSIVE MODE;

CREATE SEQUENCE execution_no_seq AS BIGINT NO CYCLE CACHE 1;
SELECT setval('execution_no_seq',
  GREATEST(
    COALESCE((SELECT MAX(execution_no) FROM executions), 0),
    COALESCE((SELECT MAX(last_execution_no) FROM campaigns), 0),
    1
  ),
  EXISTS(SELECT 1 FROM executions) OR EXISTS(SELECT 1 FROM campaigns WHERE last_execution_no > 0)
);
ALTER TABLE executions ALTER COLUMN execution_no SET DEFAULT nextval('execution_no_seq');
ALTER SEQUENCE execution_no_seq OWNED BY executions.execution_no;
COMMENT ON COLUMN campaigns.last_execution_no IS 'Legacy campaign counter retained for existing data; new IDs use execution_no_seq';
