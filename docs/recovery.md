# Disaster Recovery Procedure: Off-Chain Metadata (data.json)

This document outlines the step-by-step recovery procedure for off-chain asset metadata stored in `data.json` in the event of accidental deletion, corruption, or deployment failure.

---

## 1. Automated Backup Sources
Off-chain metadata is automatically backed up via two redundant mechanisms:
1. **GitHub Actions Artifacts:** Daily snapshots of `data.json` are archived with a 365-day retention policy.
2. **Dedicated Backup Branch (`backup-storage`):** The CI/CD pipeline automatically commits daily snapshots to an isolated orphan branch named `backup-storage` within the repository.

---

## 2. Recovery Steps

### Method A: Recover from the Backup Branch (`backup-storage`)
If the primary `data.json` file is accidentally deleted or corrupted:
1. Inspect the historical snapshots stored on the backup branch:
   ```bash
   git fetch origin backup-storage
   git checkout origin/backup-storage -- data.json
   ```
2. Verify the integrity and contents of the restored file:
   ```bash
   git status
   cat data.json
   ```
3. Commit the restored file back to your active working branch:
   ```bash
   git add data.json
   git commit -m "fix(recovery): restore data.json from backup-storage branch"
   git push origin main
   ```

### Method B: Recover from GitHub Actions Artifacts
1. Navigate to your repository on GitHub -> **Actions** -> **Automated Data Backup**.
2. Select the most recent successful workflow run.
3. Scroll down to the **Artifacts** section and download `data-json-snapshot-<run_id>`.
4. Extract the archive and place `data.json` back into the root directory (or `backend/`).
5. Commit and push the recovered file.

### Method C: Recover from Local Git Reflog / Commit History
If the file was tracked previously in git history:
```bash
git log --all --full-history -- "**/data.json"
git checkout <commit-hash> -- data.json
```
