import Badge from './Badge';

export default {
  title: 'Components/Badge',
  component: Badge,
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['success', 'danger', 'warning'],
    },
  },
};

const Template = (args) => <Badge {...args}>Badge</Badge>;

export const Success = Template.bind({});
Success.args = {
  variant: 'success',
};

export const Danger = Template.bind({});
Danger.args = {
  variant: 'danger',
};

export const Warning = Template.bind({});
Warning.args = {
  variant: 'warning',
};
