import Card from './Card';

export default {
  title: 'Components/Card',
  component: Card,
  argTypes: {
    hoverable: { control: 'boolean' },
  },
};

const Template = (args) => (
  <div style={{ padding: '1rem', background: 'var(--bg-primary)' }}>
    <Card {...args}>
      <h3>Card title</h3>
      <p>Card body content goes here.</p>
    </Card>
  </div>
);

export const Default = Template.bind({});
Default.args = {
  hoverable: false,
};

export const Hoverable = Template.bind({});
Hoverable.args = {
  hoverable: true,
};
