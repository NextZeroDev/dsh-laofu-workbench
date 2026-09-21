# Product Contracts

The first release runs for one local user, but every durable record carries a
`scope` object. `workspaceId`, `ownerId`, and optional `teamId` are mandatory
at this boundary, so adding authentication and shared workspaces later does
not require a migration from anonymous records.

The DSH Profile is the runtime boundary. LWB does not define a parallel
`complete()` contract: model calls, Session persistence, Workspace membership,
event streams, projections, and credentials are consumed through DSH services.
Future LWB model providers will be Cordis LLM adapter plugins registered on
`ctx.llm`, and future product UI will use DSH client RPC and slots.

Secrets never appear in browser bootstrap responses. The DSH credentials
service owns their local persistence for the single-user release; a future
multi-user deployment must provide an authenticated credentials backend before
exposing the Profile beyond loopback.
