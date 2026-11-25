import { useCallback, useEffect, useState } from 'react';

// Demo certificate metadata until the NFT contract query is wired up (#788).
const DEMO_CERTIFICATES = [
  {
    id: 'NFT-CERT-001',
    assetTitle: 'Luxury Manhattan Condo Unit 12B',
    sharesOwned: 10,
    mintDate: '2026-09-12',
    imageUrl:
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=600&q=80',
    contractId: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE',
  },
  {
    id: 'NFT-CERT-002',
    assetTitle: 'Silicon Valley Tech Park Parcel A',
    sharesOwned: 5,
    mintDate: '2026-10-01',
    imageUrl:
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=600&q=80',
    contractId: 'CC1234567890ABCDEFGHJKLMNOPQRSTUVWXYZ23456789ABCDEFGH',
  },
];

/**
 * Loads the certificates owned by the connected wallet. Returns no
 * certificates while no wallet is connected.
 */
export function useNftCertificates(walletAddress) {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCertificates = useCallback(async () => {
    if (!walletAddress) {
      setCertificates([]);
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Simulated NFT contract metadata query for owned certificates.
      setCertificates(DEMO_CERTIFICATES);
    } catch (err) {
      console.error('Failed to fetch NFT certificates:', err);
      setError('Unable to load certificates from the NFT contract.');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchCertificates();
  }, [fetchCertificates]);

  return {
    certificates,
    loading,
    error,
    refetch: fetchCertificates,
  };
}

export default useNftCertificates;
