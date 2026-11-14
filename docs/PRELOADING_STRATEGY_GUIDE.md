# Intelligent Resource Preloading Strategy Guide

To achieve instantaneous navigation and optimal page load performance, the RWA Marketplace implements an intelligent preloading strategy.

## 1. Strategies Implemented
- **Critical Above-the-Fold Preloading (`rel="preload"`):** Forces high-priority retrieval for immediate assets (fonts, hero images, critical CSS/JS chunks).
- **Predictive Route Prefetching (`rel="prefetch"`):** Downloads secondary chunks and resources during idle browser time based on likely user navigation patterns.
- **Intersection Observer Preloading:** Defays asset prefetching until a container or link comes within `200px` of the viewable screen boundary.

## 2. Network Conditions & Data-Saver Respect
The preloader queries the Network Information API (`navigator.connection`) and immediately abstains from prefetching or preloading if:
- The user has **Data Saver (`saveData`)** enabled.
- The user is browsing on a restricted **`2g` or `slow-2g`** cellular connection.

## 3. Monitoring & Cache Management
Preloaded assets leverage standard browser HTTP caching headers (`Cache-Control`), ensuring zero redundant network overhead when the user actually navigates to the target view.
