import Input from './Input';

export default {
  title: 'Components/Input',
  component: Input,
  argTypes: {
    type: {
      control: { type: 'select' },
      options: ['text', 'email', 'password', 'number'],
    },
    label: { control: 'text' },
    disabled: { control: 'boolean' },
  },
};

const Template = (args) => <Input {...args} />;

export const Text = Template.bind({});
Text.args = {
  id: 'input-text',
  label: 'Name',
  placeholder: 'Enter your name',
  type: 'text',
};

export const Password = Template.bind({});
Password.args = {
  id: 'input-password',
  label: 'Password',
  placeholder: 'Enter password',
  type: 'password',
};

export const Disabled = Template.bind({});
Disabled.args = {
  id: 'input-disabled',
  label: 'Disabled',
  placeholder: 'Disabled input',
  disabled: true,
};
