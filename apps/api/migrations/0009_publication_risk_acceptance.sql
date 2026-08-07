ALTER TABLE publications
  ADD COLUMN IF NOT EXISTS risk_acceptance jsonb;

ALTER TABLE publications
  ADD CONSTRAINT publications_risk_acceptance_shape_ck CHECK (
    risk_acceptance IS NULL OR (
      jsonb_typeof(risk_acceptance->'findingDigests') = 'array'
      AND jsonb_array_length(risk_acceptance->'findingDigests') > 0
      AND length(risk_acceptance->>'reason') BETWEEN 3 AND 2000
      AND length(risk_acceptance->>'acceptedByUserId') > 0
    )
  );
