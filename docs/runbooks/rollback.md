# Application rollback

Rollback replaces API and worker with a previously verified immutable tag. Migrations are forward-only and must be
compatible with the prior application during the release window.

1. Stop the rollout if readiness or smoke checks fail.
2. Record the failing tag, request IDs, metrics, and container logs.
3. Run:

```sh
export AGENTDOOR_PRODUCTION_ENV=/etc/agentdoor/agentdoor.env
export AGENTDOOR_ROLLBACK_TAG=0.0.9-fedcba987654
infra/deploy/rollback.sh
```

4. Verify readiness, login, capability search, install-plan generation, audit reads, and worker processing.
5. Confirm that the outbox backlog decreases and that no new high-severity alert fires.

The rollback script deliberately does not run or undo migrations. If the schema is not backward compatible, stop
writes at ingress and follow the restore runbook after declaring an incident. Never point a rollback at `latest`.
