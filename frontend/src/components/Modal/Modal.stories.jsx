import React from 'react';
import Modal from './Modal';

export default {
  title: 'Components/Modal',
  component: Modal,
  argTypes: {
    onClose: { action: 'onClose' },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Accessible dialog rendered through a React portal. Closes on Escape key press, on backdrop click, or via the onClose callback. Use `title` for the heading and `actions` for a footer with buttons.',
      },
    },
  },
};

function Template(args) {
  return (
    <div
      style={{
        padding: '2rem',
        height: '60vh',
        background: 'var(--bg-primary)',
      }}
    >
      <Modal {...args} />
    </div>
  );
}

export const Simple = Template.bind({});
Simple.args = {
  title: 'Confirm Purchase',
  children: <p>Are you sure you want to purchase these shares?</p>,
  actions: (
    <>
      <button>Cancel</button>
      <button>Confirm</button>
    </>
  ),
};

export const InfoOnly = Template.bind({});
InfoOnly.args = {
  title: 'Announcement',
  children: (
    <p>
      New yield distributions are available for the Real Estate fund. Check your
      dashboard for the latest payouts.
    </p>
  ),
};

export const WithoutTitle = Template.bind({});
WithoutTitle.args = {
  children: (
    <p>
      A modal that does not include a title. The heading is optional.
    </p>
  ),
  actions: (
    <button>Got it</button>
  ),
};
