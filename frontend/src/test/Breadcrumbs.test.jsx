import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs/Breadcrumbs';

describe('Breadcrumbs JSON-LD', () => {
  it('escapes HTML-sensitive characters in an untrusted breadcrumb label', () => {
    const maliciousLabel = '</script><script>window.injected = true</script>&';
    const { container } = render(
      <MemoryRouter>
        <Breadcrumbs
          items={[
            { label: 'Home', path: '/' },
            { label: maliciousLabel, path: '/asset' },
          ]}
        />
      </MemoryRouter>,
    );

    const nav = container.querySelector('nav');
    const scripts = nav.querySelectorAll('script');

    expect(scripts).toHaveLength(1);
    expect(scripts[0].textContent).toContain('\\u003c/script\\u003e');
    expect(scripts[0].textContent).toContain('\\u0026');
    expect(JSON.parse(scripts[0].textContent).itemListElement[1].name).toBe(maliciousLabel);
  });
});
