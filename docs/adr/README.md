# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records documenting significant technical decisions made in the Tokenized Fractional RWA Marketplace project.

## What is an ADR?

An Architecture Decision Record (ADR) is a document that captures an important architectural decision made along with its context and consequences.

## Format

Each ADR follows this structure:
- **Context**: The issue we're addressing and forces influencing the decision
- **Decision**: What we decided and why
- **Consequences**: Benefits, drawbacks, and tradeoffs
- **Alternatives Considered**: Other options evaluated

## Current ADRs

| Number | Title | Status |
|--------|-------|--------|
| [0001](0001-use-soroban-smart-contracts.md) | Use Soroban Smart Contracts for RWA Marketplace | Accepted |
| [0002](0002-file-based-asset-storage.md) | File-Based Asset Storage (data.json) for Metadata | Accepted |
| [0003](0003-react-vite-frontend.md) | Use React + Vite for Frontend Development | Accepted |

## How to Add a New ADR

1. Create a new file: `000X-short-title-in-kebab-case.md`
2. Use the [template](0000-template.md) as a starting point
3. Ensure the ADR has clear context, decision, and consequences
4. Add to this README's table
5. Submit as a pull request for team review

## When to Write an ADR

Write an ADR when you need to document:
- Technology choices (frameworks, databases, platforms)
- Architectural patterns or approaches
- Major refactoring decisions
- Trade-offs between competing solutions
- Decisions that have long-term impact on the codebase

## Status Legend

- **Proposed**: Under discussion, not yet accepted
- **Accepted**: Decision made and approved by the team
- **Deprecated**: Superseded by a newer ADR
- **Superseded by ADR-XXXX**: Replaced by a newer decision
