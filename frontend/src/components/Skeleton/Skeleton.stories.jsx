import Skeleton from './Skeleton';

export default {
  title: 'Components/Skeleton',
  component: Skeleton,
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['rect', 'text', 'circle'],
    },
    width: { control: 'text' },
    height: { control: 'text' },
    lines: { control: 'number' },
  },
};

function Template(args) {
  return <Skeleton {...args} />;
}

export const Rect = Template.bind({});
Rect.args = {
  variant: 'rect',
  width: '100%',
  height: '2rem',
};

export const Text = Template.bind({});
Text.args = {
  variant: 'text',
  width: '80%',
  lines: 3,
};

export const Circle = Template.bind({});
Circle.args = {
  variant: 'circle',
  width: '48px',
  height: '48px',
};
