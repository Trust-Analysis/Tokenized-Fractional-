import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PreferencesPanel from '../components/PreferencesPanel/PreferencesPanel';
import { usePreferencesStore } from '../store/usePreferencesStore';
import { DEFAULT_PREFERENCES, PREFERENCES_STORAGE_KEY } from '../utils/preferences';

describe('PreferencesPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferencesStore.setState({ ...DEFAULT_PREFERENCES });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<PreferencesPanel open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the current preferences when open', () => {
    render(<PreferencesPanel open onClose={() => {}} />);

    expect(screen.getByRole('dialog', { name: /preferences/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/display currency/i)).toHaveValue('USD');
    expect(screen.getByLabelText(/price of a held asset changes/i)).toBeChecked();
  });

  it('updates the preview and persists the selection on save', () => {
    render(<PreferencesPanel open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(/display currency/i), { target: { value: 'EUR' } });
    expect(screen.getByTestId('preferences-preview')).toHaveTextContent('1,250');

    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    expect(usePreferencesStore.getState().displayCurrency).toBe('EUR');
    const persisted = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY));
    expect(persisted.state.displayCurrency).toBe('EUR');
  });

  it('resets to the shipped defaults', () => {
    usePreferencesStore.setState({ displayCurrency: 'NGN', compactNumbers: true });
    render(<PreferencesPanel open onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));

    expect(usePreferencesStore.getState().displayCurrency).toBe('USD');
    expect(usePreferencesStore.getState().compactNumbers).toBe(false);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<PreferencesPanel open onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
