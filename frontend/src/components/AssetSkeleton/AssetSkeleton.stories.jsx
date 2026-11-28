import AssetSkeleton from './AssetSkeleton';

export default {
  title: 'Components/AssetSkeleton',
  component: AssetSkeleton,
  parameters: {
    docs: {
      description: {
        component: 'Loading placeholder for asset metadata, pricing, and holdings. Shows animated skeleton UI while Soroban RPC calls are in-flight.',
      },
    },
  },
  decorators: [
    (Story, context) => {
      // Apply theme via data-theme attribute
      const theme = context.parameters.theme || 'dark';
      return (
        <div data-theme={theme} style={{ padding: '2rem', backgroundColor: 'var(--color-bg, #0a0e27)' }}>
          <Story />
        </div>
      );
    },
  ],
};

export const DarkTheme = {
  parameters: {
    theme: 'dark',
  },
  render: () => <AssetSkeleton />,
};

export const LightTheme = {
  parameters: {
    theme: 'light',
  },
  render: () => <AssetSkeleton />,
};

export const MultipleSkeletons = {
  parameters: {
    theme: 'dark',
  },
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <AssetSkeleton />
      <AssetSkeleton />
    </div>
  ),
};

export const LightThemeMultiple = {
  parameters: {
    theme: 'light',
  },
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <AssetSkeleton />
      <AssetSkeleton />
    </div>
  ),
};
