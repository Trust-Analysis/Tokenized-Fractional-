import { Router } from 'express';
import { addToWhitelist, removeFromWhitelist, addToBlacklist, removeFromBlacklist, setWhitelistEnabled, getWhitelist, getBlacklist, isWhitelistEnabled } from '../middleware/ipAccessControl.js';

export function createIPAccessRoutes(logger, adminAuth) {
  const router = Router();

  router.get('/whitelist', adminAuth, (req, res) => {
    res.json({ whitelist: getWhitelist(), enabled: isWhitelistEnabled() });
  });

  router.post('/whitelist', adminAuth, async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP address required' });
    await addToWhitelist(ip);
    res.json({ message: 'IP added to whitelist', ip });
  });

  router.delete('/whitelist/:ip', adminAuth, async (req, res) => {
    await removeFromWhitelist(req.params.ip);
    res.json({ message: 'IP removed from whitelist' });
  });

  router.get('/blacklist', adminAuth, (req, res) => {
    res.json({ blacklist: getBlacklist() });
  });

  router.post('/blacklist', adminAuth, async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP address required' });
    await addToBlacklist(ip);
    res.json({ message: 'IP added to blacklist', ip });
  });

  router.delete('/blacklist/:ip', adminAuth, async (req, res) => {
    await removeFromBlacklist(req.params.ip);
    res.json({ message: 'IP removed from blacklist' });
  });

  router.post('/whitelist/toggle', adminAuth, async (req, res) => {
    const { enabled } = req.body;
    await setWhitelistEnabled(enabled);
    res.json({ message: 'Whitelist mode ' + (enabled ? 'enabled' : 'disabled') });
  });

  logger.info('IP access control routes initialized');
  return router;
}