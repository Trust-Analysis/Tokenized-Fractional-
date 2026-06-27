import Alert from './Alert';

export default {
  title: 'Components/Alert',
  component: Alert,
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['error', 'success', 'warning'],
    },
  },
};

const Template = (args) => <Alert {...args}>This is an alert message.</Alert>;

export const Error = Template.bind({});
Error.args = {
  variant: 'error',
};

export const Success = Template.bind({});
Success.args = {
  variant: 'success',
};

export const Warning = Template.bind({});
Warning.args = {
  variant: 'warning',
};
