const fs = require("fs");
const path = require("path");

function runBenchmark() {
  console.log("📊 Running Flat-File (data.json) Scaling Benchmarks...");
  const sizes = [10, 100, 1000, 10000];
  const tempFile = path.join(__dirname, "temp_bench.json");

  sizes.forEach(size => {
    // Generate mock dataset
    const assets = Array.from({ length: size }, (_, i) => ({
      contractId: `CC_ASSET_${i}_HASH`,
      title: `Asset Number ${i}`,
      valuation: (i + 1) * 10000,
      status: i % 2 === 0 ? "approved" : "pending",
      createdAt: new Date().toISOString()
    }));

    // Measure Write (JSON.stringify + writeFileSync)
    const writeStart = process.hrtime.bigint();
    fs.writeFileSync(tempFile, JSON.stringify(assets, null, 2), "utf8");
    const writeEnd = process.hrtime.bigint();
    const writeMs = Number(writeEnd - writeStart) / 1e6;

    // Measure Read & Parse (readFileSync + JSON.parse + filter)
    const readStart = process.hrtime.bigint();
    const raw = fs.readFileSync(tempFile, "utf8");
    const parsed = JSON.parse(raw);
    const filtered = parsed.filter(a => a.status === "approved");
    const readEnd = process.hrtime.bigint();
    const readMs = Number(readEnd - readStart) / 1e6;

    const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;

    console.log(`Size: ${size.toString().padEnd(6)} | Read: ${readMs.toFixed(3).padEnd(8)} ms | Write: ${writeMs.toFixed(3).padEnd(8)} ms | Heap: ${memUsage.toFixed(2)} MB`);
  });

  if (fs.existsSync(tempFile)) {
    fs.unlinkSync(tempFile);
  }
}

if (require.main === module) {
  runBenchmark();
}
module.exports = runBenchmark;
