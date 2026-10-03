# Development Setup

The Linux bootstrap script installs the local toolchains used by this repository:

- Node.js from `.nvmrc` through nvm
- Docker Engine and Git through apt
- Terraform CLI from HashiCorp's signed apt repository
- Rust, the WebAssembly target, and the Soroban CLI
- Backend and frontend dependencies and local `.env` files

Run it from the repository root:

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

The script targets Ubuntu and Debian systems. It may ask for sudo access to install packages. Start a new shell after setup if Docker reports that your user was added to the `docker` group.

## SSH aliases for multiple GitHub accounts

Use a host alias when one machine has more than one GitHub identity. The alias selects the key; the repository owner in the remote URL still determines the GitHub repository.

Create or update `~/.ssh/config`:

```sshconfig
Host Alhaji-naira
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_alhaji_naira
    IdentitiesOnly yes
```

Create the key if needed, protect it, and add its public key to the intended GitHub account:

```bash
ssh-keygen -t ed25519 -C "alhaji-naira@users.noreply.github.com" -f ~/.ssh/id_ed25519_alhaji_naira
chmod 600 ~/.ssh/id_ed25519_alhaji_naira
ssh -T git@Alhaji-naira
```

Configure this repository to use that identity for the Trust Analysis repository:

```bash
git remote set-url origin git@Alhaji-naira:Trust-Analysis/Tokenized-Fractional-.git
git remote set-url upstream git@Alhaji-naira:Trust-Analysis/Tokenized-Fractional-.git
git remote -v
```

The setup script can apply the same routing without replacing existing remotes:

```bash
./scripts/setup.sh --configure-git
```

To replace existing `origin` and `upstream` URLs, use the explicit opt-in flag:

```bash
./scripts/setup.sh --configure-git --force-git
```

Test the alias before pushing:

```bash
git ls-remote origin HEAD
git push origin HEAD
```

Do not use `git@github.com:...` for this repository when the default SSH key belongs to another account; the unaliased host bypasses the `Alhaji-naira` key selection.