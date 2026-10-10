# Jenkins Integration Pipeline

The root [`Jenkinsfile`](../Jenkinsfile) provides a heavier CI path for the off-chain API and Soroban contracts. This checkout currently uses an Express service; the pipeline's command parameter also supports a Fastify/NestJS integration harness when one is introduced. It runs:

1. Backend, frontend, and SDK dependency installation in parallel.
2. Strict SDK typechecking.
3. The full Rust contract test suite.
4. The state-change resource benchmark suite, with an optional CPU ceiling.
5. The full backend Jest suite.
6. A Docker Compose integration smoke test against PostgreSQL, Redis, and the backend API.

## Jenkins agent requirements

Use a Linux agent labelled `docker` with these tools available:

- Node.js 20.18 or later and npm
- Docker Engine with the Compose plugin
- Rust/Cargo and `rustup`
- `curl`

Set the optional Jenkins environment variable `MAX_CPU_INSTRUCTIONS` to fail builds when a benchmark exceeds the approved CPU budget.

The agent user must be allowed to access `/var/run/docker.sock`. The pipeline creates an isolated Compose project named with the Jenkins build number and removes its containers and volumes in `post { always { ... } }`.

## Creating the job

Create a Pipeline job configured as **Pipeline script from SCM**, point it at this repository, and use `Jenkinsfile` as the script path. A multibranch Pipeline is recommended so pull requests and branches receive the same integration gates.

## Contract test overrides

The `ONCHAIN_INTEGRATION_COMMAND` parameter defaults to `cargo test --locked`, which runs the deterministic contract integration tests without requiring a wallet or network secret. A Jenkins administrator can override it for a live test harness, for example:

```text
cargo test --locked --test testnet_integration -- --nocapture
```

Live tests should use Jenkins credentials or environment injection for keys and RPC URLs. Never commit those values to the repository or print them in build logs.