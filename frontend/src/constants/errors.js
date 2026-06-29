export const TX_CONFIRMED = 'Transaction confirmed';
export const TX_FAILED = 'Transaction failed';
export const TX_SUBMITTED = 'Transaction submitted, waiting for confirmation…';
export const TX_FAILED_CHECK_BALANCE = 'Transaction failed. Check your token balance and try again.';
export const TX_FAILED_PAUSED = 'Marketplace is currently paused. Try again later.';
export const TX_FAILED_NO_SHARES = 'Not enough shares available.';
export const FAILED_FETCH_SHARE_BALANCE = 'Failed to fetch share balance.';
export const MUST_BUY_AT_LEAST_ONE_SHARE = 'Must buy at least 1 share';
export const CONTRACT_NOT_CONFIGURED = 'Set VITE_CONTRACT_ID in frontend/.env to connect to a deployed contract.';

export const FAILED_TO_LOAD_PORTFOLIO = 'Failed to load portfolio data.';
export const FAILED_TO_FETCH_PORTFOLIO_ASSET = 'Failed to fetch';
export const FAILED_TO_LOAD_ASSETS = 'Failed to load assets';

export const PAUSE_TOGGLE_FAILED = 'Pause toggle transaction failed';
export const PAUSE_SUCCESS = (isPaused) => `Marketplace ${isPaused ? 'unpaused' : 'paused'} successfully`;
export const FAILED_TO_TOGGLE_PAUSE = 'Failed to toggle pause state';
export const WALLET_AND_CONTRACT_REQUIRED = 'Wallet must be connected and contract must be configured';
export const SIGNING_FAILED = 'Signing failed';

export const EMERGENCY_WITHDRAW_CONFIRMED = 'Emergency withdraw confirmed';
export const EMERGENCY_WITHDRAW_TX_FAILED = 'Emergency withdraw transaction failed';
export const EMERGENCY_WITHDRAW_SUBMITTED = 'Emergency withdraw submitted, waiting for confirmation…';
export const EMERGENCY_WITHDRAW_FAILED = 'Emergency withdraw failed';
export const ENTER_VALID_AMOUNT = 'Enter a valid positive amount to withdraw';

export const API_KEY_REQUIRED = 'API key is required';
export const AUTH_FAILED_CHECK_KEY = 'Authentication failed. Check your API key.';
export const AUTH_FAILED = 'Authentication failed';

export const FAILED_TO_SAVE_ASSET = 'Failed to save asset';
export const FAILED_TO_DELETE_ASSET = 'Failed to delete asset';
export const ENTER_CONTRACT_ID_TO_DELETE = 'Enter a contract ID to delete';
export const SERVER_ERROR = (status) => `Server error (${status})`;
export const MISSING_REQUIRED_FIELDS = (fields) => `Missing required fields: ${fields.join(', ')}`;

export const UNEXPECTED_ERROR = 'Something went wrong';
export const ERROR_REPORTED = 'An unexpected error occurred. The error has been reported to our team.';
export const TRY_AGAIN = 'Try Again';
