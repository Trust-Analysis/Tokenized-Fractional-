import Spinner from './Spinner';

export default {
  title: 'Components/Spinner',
  component: Spinner,
  argTypes: {
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
    },
    label: { control: 'text' },
  },
};

const Template = (args) => <Spinner {...args} />;

export const Medium = Template.bind({});
Medium.args = {
  size: 'md',
};

export const Small = Template.bind({});
Small.args = {
  size: 'sm',
};

export const Large = Template.bind({});
Large.args = {
  size: 'lg',
};
