import { Networks } from '@stellar/stellar-sdk';

export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || 'C...';
export const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Address shown by the official-contract verification card (Issue #787).
export const ACTIVE_CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
