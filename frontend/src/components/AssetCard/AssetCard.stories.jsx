import React from 'react';
import AssetCard from './AssetCard';

const baseAsset = {
  contractId: 'CCGV7VHPLPZV55G3SQO6UCM5X7GQX3RTDF5KNX7ZK5JJ5V5Q63G3TS4RM',
  title: 'Riverfront Logistics Warehouse',
  location: 'Rotterdam, Netherlands',
  totalValuation: '$2,450,000',
  assetType: 'Industrial Real Estate',
  imageUrl:
    'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=640&q=80',
};

export default {
  title: 'Components/AssetCard',
  component: AssetCard,
  argTypes: {
    isLive: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Card that displays a tokenized RWA asset with image, title, location, valuation, favorite bookmark, quick view, and price history actions. Includes a Compare checkbox (limited to 4 assets).',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: '2rem',
          background: 'var(--bg-primary)',
          maxWidth: '380px',
        }}
      >
        <Story />
      </div>
    ),
  ],
};

function Template(args) {
  return <AssetCard {...args} />;
}

export const Default = Template.bind({});
Default.args = {
  asset: { ...baseAsset },
  isLive: false,
};

export const Live = Template.bind({});
Live.args = {
  asset: { ...baseAsset },
  isLive: true,
};

export const WithoutImage = Template.bind({});
WithoutImage.args = {
  asset: {
    contractId: 'GCQH3X2F6RT4Y6S7JKCWQ8OLWQ4N9WUQFT7AQRXCY5BZM6J2KKHPOIM3',
    title: 'Solar Farm Bonds',
    location: 'Andalusia, Spain',
    totalValuation: '$1,180,000',
    assetType: 'Renewable Energy',
  },
  isLive: false,
};
