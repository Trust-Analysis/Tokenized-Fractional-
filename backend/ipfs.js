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
    const PINATA_JWT = process.env.PINATA_JWT;
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
  formData.append(
    'pinataMetadata',
    JSON.stringify({ name: `${assetName} - ${originalName}` })
  );

  // Request CIDv1
  formData.append(
    'pinataOptions',
    JSON.stringify({ cidVersion: 1 })
  );

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
    const PINATA_JWT = process.env.PINATA_JWT;
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

// ---------------------------------------------------------------------------
// pinJSONToIPFS
// ---------------------------------------------------------------------------
// Takes a JavaScript object, serializes it to JSON, and pins it to IPFS via Pinata.
// Returns the CID, gateway URL, and canonical IPFS URI (ipfs://<cid>).
// ---------------------------------------------------------------------------
export async function pinJSONToIPFS(jsonMetadata, assetName = 'Asset Metadata') {
  const PINATA_JWT = process.env.PINATA_JWT;
  if (!PINATA_JWT) {
    throw new Error('PINATA_JWT is not configured. Add it to your .env file.');
  }

  const payload = {
    pinataContent: jsonMetadata,
    pinataMetadata: {
      name: `${assetName} - metadata.json`,
    },
    pinataOptions: {
      cidVersion: 1,
    },
  };

  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata JSON pin failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  const cid = json.IpfsHash;

  return {
    cid,
    url: `${PINATA_GATEWAY}/ipfs/${cid}`,
    uri: `ipfs://${cid}`,
  };
}

// ---------------------------------------------------------------------------
// pinAssetMetadataToIPFS
// ---------------------------------------------------------------------------
// Full tokenization helper (Issue #516):
// 1. Pins associated image to IPFS (if buffer provided) -> gets image CID
// 2. Pins associated appraisal documents to IPFS (if provided) -> gets appraisal CIDs
// 3. Combines asset properties, image CID, and appraisal CIDs into JSON metadata
// 4. Pins the final JSON metadata to IPFS -> returns resulting metadata CID & URI
// ---------------------------------------------------------------------------
export async function pinAssetMetadataToIPFS({
  metadata,
  imageBuffer = null,
  imageFileName = 'asset-image.jpg',
  appraisals = [],
}) {
  const assetName = metadata.title || metadata.name || 'Tokenized Asset';
  let imageCid = metadata.imageCid || null;
  let imageUrl = metadata.imageUrl || '';

  // 1. Pin image to IPFS if image buffer provided
  if (imageBuffer) {
    const uploadedImage = await uploadToIPFS(imageBuffer, imageFileName, assetName);
    imageCid = uploadedImage.cid;
    imageUrl = uploadedImage.url;
  }

  // 2. Pin appraisal documents if provided
  const pinnedAppraisals = [];
  if (Array.isArray(appraisals)) {
    for (const doc of appraisals) {
      if (doc.buffer) {
        const uploadedDoc = await uploadToIPFS(doc.buffer, doc.name || 'appraisal.pdf', assetName);
        pinnedAppraisals.push({
          cid: uploadedDoc.cid,
          url: uploadedDoc.url,
          name: doc.name || 'appraisal.pdf',
          mimeType: doc.mimeType || 'application/pdf',
          size: doc.size || doc.buffer.length,
          uploadedAt: new Date().toISOString(),
        });
      } else if (doc.cid) {
        pinnedAppraisals.push(doc);
      }
    }
  }

  // 3. Combine into decentralized metadata JSON
  const canonicalMetadata = {
    name: metadata.title || metadata.name,
    title: metadata.title || metadata.name,
    description: metadata.description || '',
    location: metadata.location || '',
    assetType: metadata.assetType || 'real_estate',
    totalValuation: metadata.totalValuation || '',
    totalShares: metadata.totalShares ? Number(metadata.totalShares) : undefined,
    pricePerShare: metadata.pricePerShare ? Number(metadata.pricePerShare) : undefined,
    image: imageCid ? `ipfs://${imageCid}` : imageUrl,
    imageUrl: imageUrl || (imageCid ? `${PINATA_GATEWAY}/ipfs/${imageCid}` : ''),
    imageCid: imageCid || undefined,
    documents: [...(Array.isArray(metadata.documents) ? metadata.documents : []), ...pinnedAppraisals],
    appraisals: pinnedAppraisals,
    properties: {
      contractId: metadata.contractId || '',
      tokenizedAt: new Date().toISOString(),
      ...(metadata.properties || {}),
    },
  };

  // 4. Pin JSON metadata to IPFS
  const pinnedJson = await pinJSONToIPFS(canonicalMetadata, assetName);

  return {
    metadataCid: pinnedJson.cid,
    metadataUri: pinnedJson.uri,
    metadataUrl: pinnedJson.url,
    imageCid,
    imageUrl,
    canonicalMetadata,
    documents: canonicalMetadata.documents,
  };
}