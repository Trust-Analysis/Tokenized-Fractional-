describe("Freighter Wallet Missing Handling", () => {
  it("shows actionable install prompt when Freighter is not installed", () => {
    cy.visit("/", {
      onBeforeLoad(win) {
        delete win.freighter;
        delete win.stellar;
      },
    });
    cy.contains("Freighter Wallet Required").should("be.visible");
    cy.get("a[href*=\"freighter.app\"]").should("have.attr", "href", "https://www.freighter.app/");
  });
});
