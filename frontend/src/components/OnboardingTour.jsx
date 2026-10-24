import React, { useState, useEffect } from 'react';
import Joyride, { STATUS } from 'react-joyride';

const OnboardingTour = () => {
  const [run, setRun] = useState(false);

  useEffect(() => {
    const hasCompletedTour = localStorage.getItem('hasCompletedTour');
    // Only run the tour if the user hasn't completed or skipped it before
    if (!hasCompletedTour) {
      setRun(true);
    }
  }, []);

  const steps = [
    {
      target: '.tour-wallet-connect',
      content: 'Welcome! Start by connecting your Web3 wallet (like Freighter) to interact with the marketplace.',
      disableBeacon: true,
    },
    {
      target: '.tour-asset-selection',
      content: 'Browse and select the real-world assets you want to buy fractional shares in.',
    },
    {
      target: '.tour-order-book',
      content: 'View market depth, available shares, and place your orders here.',
    },
    {
      target: '.tour-portfolio',
      content: 'Track your owned shares, NFT certificates, and overall portfolio performance here.',
    }
  ];

  const handleJoyrideCallback = (data) => {
    const { status } = data;
    const finishedStatuses = [STATUS.FINISHED, STATUS.SKIPPED];
    
    if (finishedStatuses.includes(status)) {
      localStorage.setItem('hasCompletedTour', 'true');
      setRun(false);
    }
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous={true}
      showProgress={true}
      showSkipButton={true}
      callback={handleJoyrideCallback}
      styles={{
        options: {
          primaryColor: '#3b82f6', // You can tweak this to match the app's brand color
          zIndex: 10000,
        }
      }}
    />
  );
};

export default OnboardingTour;
