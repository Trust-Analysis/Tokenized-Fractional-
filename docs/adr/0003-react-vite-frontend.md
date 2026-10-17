# ADR-0003: Use React + Vite for Frontend Development

**Date:** 2026-06-28  
**Status:** Accepted  
**Author:** Team

## Context

The frontend needed a modern framework that could:
- Build a responsive, interactive marketplace UI
- Integrate with Freighter wallet for transaction signing
- Support component-based architecture and styling
- Have fast development and build times
- Allow for easy testing and state management

## Decision

We chose **React** with **Vite** as the build tool. React handles UI components and state, while Vite provides fast development server and optimized production builds.

## Consequences

### Positive
- **Component reusability**: React's component model enables code reuse and maintainability
- **Large ecosystem**: Extensive libraries for state management (Zustand), UI components, testing
- **Fast development**: Vite's HMR (Hot Module Replacement) provides instant feedback
- **Optimized builds**: Vite generates small, efficient bundles
- **Developer experience**: Excellent tooling and community resources
- **ESM-based**: Modern JavaScript modules improve performance and debugging
- **Easy wallet integration**: Freighter provides good React integration examples

### Negative
- **JavaScript complexity**: Adds runtime overhead compared to static HTML
- **Learning curve**: React's concepts (JSX, hooks, state) require learning
- **Build step required**: Cannot run directly; requires compilation
- **Dependency updates**: Requires maintaining package dependencies
- **SEO challenges**: SPA requires additional setup for search engine optimization
- **Bundle size**: Initial load includes JavaScript runtime

## Alternatives Considered

### Vue.js
Good framework but less ecosystem support for blockchain integrations compared to React.

### Angular
Rejected due to excessive complexity for this project's scope; better for large enterprise apps.

### Static HTML + jQuery
Rejected due to inability to scale UI complexity; component approach necessary.

### Svelte
Rejected; less mature wallet integration examples in Stellar ecosystem.

## Notes

- **State management**: Uses Zustand for lightweight store management
- **Styling**: CSS Modules for component-scoped styles
- **Environment variables**: Configured via `VITE_*` prefix in frontend build
- **Testing**: Playwright for E2E tests; Jest for unit tests possible
