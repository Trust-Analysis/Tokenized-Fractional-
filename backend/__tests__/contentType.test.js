const request = require("supertest");
const app = require("../server.js");

describe("Content-Type Header Enforcement on Write Endpoints (#782)", () => {
  const validKey = process.env.ADMIN_KEY_ALICE || "key-alice-secret-123";

  it("rejects POST /api/rwa with missing Content-Type header with 415", async () => {
    const res = await request(app)
      .post("/api/rwa")
      .set("x-api-key", validKey)
      .send({ contractId: "CCTEST1" });
    
    expect(res.status).toBe(415);
    expect(res.body.error).toBe("Unsupported Media Type");
  });

  it("rejects POST /api/rwa with non-JSON Content-Type header with 415", async () => {
    const res = await request(app)
      .post("/api/rwa")
      .set("x-api-key", validKey)
      .set("Content-Type", "text/plain")
      .send("contractId=CCTEST1");
    
    expect(res.status).toBe(415);
    expect(res.body.error).toBe("Unsupported Media Type");
  });

  it("rejects PATCH /api/rwa/:contractId with missing Content-Type header with 415", async () => {
    const res = await request(app)
      .patch("/api/rwa/CC123")
      .set("x-api-key", validKey)
      .send({ status: "approved" });
    
    expect(res.status).toBe(415);
    expect(res.body.error).toBe("Unsupported Media Type");
  });
});
