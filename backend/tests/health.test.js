const request = require("supertest");
const app = require("../index.js");
const fs = require("fs").promises;

describe("GET /health", () => {
  it("should return 200 ok when storage is accessible", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.dependencies.storage.status).toBe("ok");
  });

  it("should return 503 degraded when data file is unreadable/inaccessible", async () => {
    const accessSpy = jest.spyOn(fs, "access").mockRejectedValue(new Error("Permission denied / disk failure"));

    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.dependencies.storage.status).toBe("degraded");
    expect(res.body.dependencies.storage.error).toBeDefined();

    accessSpy.mockRestore();
  });
});
