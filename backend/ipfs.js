// backend/ipfs.js
// Pinata IPFS service — handles all document upload and retrieval logic.
// The rest of the app imports from here; nothing else needs to know about Pinata.

import FormData from 'form-data';

const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud';

// ---------------------------------------------------------------------------
// uploadToIPFS
// ---------------------------------------------------------------------------
// Takes a file buffer (from multer memoryStorage) and uploads it to Pinata.
// Returns the CID and a public gateway URL.
//
// Why a buffer and not a file path?
//   We use multer's memoryStorage so the file never touches the server's disk.
//   It arrives in memory as req.file.buffer and goes straight to Pinata.
//
// Why CIDv1?
//   CIDv1 is the modern format (Base32 encoded, starts with "b").
//   CIDv0 starts with "Qm" and is being phased out. New projects use v1.
// ---------------------------------------------------------------------------
export async function uploadToIPFS(fileBuffer, originalName, assetName) {
  const { PINATA_JWT } = process.env;
  if (!PINATA_JWT) {
    throw new Error('PINATA_JWT is not configured. Add it to your .env file.');
  }
  const formData = new FormData();

  // Append the raw buffer as the file field Pinata expects
  formData.append('file', fileBuffer, {
    filename: originalName,
    contentType: 'application/octet-stream',
  });

  // Label this pin on the Pinata dashboard so you can identify it later
  formData.append('pinataMetadata', JSON.stringify({ name: `${assetName} - ${originalName}` }));

  // Request CIDv1
  formData.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      ...formData.getHeaders(),
    },
    body: formData,
    signal: AbortSignal.timeout(30000), // 30s — Pinata can be slow for large files
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata upload failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  const cid = json.IpfsHash;

  return {
    cid,
    url: `${PINATA_GATEWAY}/ipfs/${cid}`,
    name: originalName,
  };
}

// ---------------------------------------------------------------------------
// getIPFSFileUrl
// ---------------------------------------------------------------------------
// Pure utility — constructs the gateway URL for a given CID.
// No network call needed just to build the URL.
// ---------------------------------------------------------------------------
export function getIPFSFileUrl(cid) {
  return `${PINATA_GATEWAY}/ipfs/${cid}`;
}

// ---------------------------------------------------------------------------
// unpinFromIPFS
// ---------------------------------------------------------------------------
// Removes a pin from Pinata when an asset is deleted.
// This stops Pinata from keeping the file alive on your account (and billing
// you for it). Note: unpinning does NOT delete the file from the IPFS network
// immediately — other nodes may still have it. It just removes your guarantee.
// ---------------------------------------------------------------------------
export async function unpinFromIPFS(cid) {
  const { PINATA_JWT } = process.env;
  if (!PINATA_JWT) {
    throw new Error('PINATA_JWT is not configured.');
  }

  const response = await fetch(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata unpin failed (${response.status}): ${text}`);
  }
}
