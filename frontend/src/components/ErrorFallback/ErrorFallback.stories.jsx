import ErrorFallback from './ErrorFallback';

export default {
  title: 'Components/ErrorFallback',
  component: ErrorFallback,
};

const Template = (args) => <ErrorFallback {...args} />;

export const Default = Template.bind({});
Default.args = {
  error: new Error('Test error'),
  componentStack: 'in App at src/App.jsx:10',
  resetError: () => alert('Reset clicked'),
};
