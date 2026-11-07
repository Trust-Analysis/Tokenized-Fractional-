describe('Accessibility Tests', () => {
  it('Passes WCAG 2.1 AA on Marketplace', () => {
    cy.visit('/');
    cy.injectAxe();
    cy.checkA11y(null, { runOnly: { type: 'tag', values: ['wcag21aa'] } });
  });

  it('Passes WCAG 2.1 AA on Portfolio', () => {
    cy.visit('/portfolio');
    cy.injectAxe();
    cy.checkA11y(null, { runOnly: { type: 'tag', values: ['wcag21aa'] } });
  });
});
