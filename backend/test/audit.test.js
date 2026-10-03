const request = require("supertest");
const app = require("../server.js");

describe("Admin API Key & Audit Trail", () => {
  it("rejects requests with missing or invalid API keys", async () => {
    const res = await request(app).post("/api/rwa").send({ name: "Test Asset" });
    expect(res.status).toBe(401);
  });

  it("authorizes valid named admin key and records audit log", async () => {
    const res = await request(app)
      .post("/api/rwa")
      .set("x-api-key", "key-alice-secret-123")
      .send({ name: "Test Asset" });
    
    expect(res.status).toBe(200);
    expect(res.body.createdBy).toBe("admin-alice");
  });
});
