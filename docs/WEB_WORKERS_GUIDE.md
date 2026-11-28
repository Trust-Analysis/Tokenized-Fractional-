# Web Workers Architecture Guide

To maintain smooth user interactions and prevent UI thread blocking during computationally intensive operations, the RWA Marketplace utilizes background Web Workers.

## 1. Offloaded Operations
- **Chart Data Processing:** Resampling time-series price data and calculating moving averages.
- **Statistical Computations:** Computing volatility, min/max bounds, and mean pricing metrics.
- **Large Dataset Filtering:** Filtering complex portfolio transactions or asset arrays.

## 2. Architecture & Message Passing
- **Worker Script (`dataProcessor.worker.js`):** Runs in an isolated background thread. Communicates via structured cloning (`postMessage`).
- **Task Queuing:** The `useDataWorker` hook assigns unique `taskId` keys to track asynchronous requests and dispatches them cleanly.
- **Lifecycle Management:** Automatically initializes the worker upon component mount and terminates (`worker.terminate()`) upon unmounting to prevent memory leaks.

## 3. Graceful Fallback
If a browser does not support Web Workers or instantiation fails, `useDataWorker` transparently falls back to synchronous execution on the main thread, guaranteeing 100% cross-browser compatibility.
