# Changes in this copy

Based on [Makabeez/flop-pc-miner](https://github.com/Makabeez/flop-pc-miner) v1.0.0 (commit fa33e61, MIT).
The original LICENSE and README are kept. Only `flop-miner.sh` changed (VERSION `1.0.0-son.9`).

## 1.0.0-son.9 (22 Nov 2026)

- **Automatic model pin.** When `setup` fetches the model and the CLI answers `MODEL_VERIFICATION_FAILED`
  because Hugging Face's `main` branch no longer matches the registered root, `setup` now runs
  `pin-model` by itself and continues, instead of failing three times and asking for a manual
  `pin-model` + `SKIP_SPONSOR=1 setup`. Other fetch errors (RPC timeouts) still retry as before.
  Seen on three fresh Vast.ai VMs (RTX 5060 Ti, RTX 4090) on 21-22 Nov 2026.

## 1.0.0-son.8 (20 Nov 2026)

- **MTU pin for WSL** (`NET_MTU_FORCE` in `/opt/flop-miner/miner.env`). `up` normally copies WSL's `eth0`
  MTU to the miner's Docker network. After a network change `eth0` reported 1492 and the worker's
  long-lived RPC WebSocket dropped with `1006 Abnormal Closure` / `WebSocket is not connected` every
  few seconds, while plain HTTPS calls to the same RPC from Windows and WSL worked. Pinning 1280 fixed
  it (0 worker disconnects in the next hour). To use it:

  ```
  wsl -d flop-miner --exec bash -c 'grep -q ^NET_MTU_FORCE= /opt/flop-miner/miner.env || echo NET_MTU_FORCE=1280 >> /opt/flop-miner/miner.env'
  ```

  then Stop and Start the miner. `up` recreates the miner network with the new MTU.

## 1.0.0-son.7 (17 Nov 2026)

- **Evidence store** (needed by miner-worker v0.1.336 and later for paid sessions): `setup` and `up` create
  `/opt/flop-miner/audit-key/evidence.key` once (root, 600), and the worker gets
  `SESSION_AUDIT_EVIDENCE_DIR` and `SESSION_AUDIT_EVIDENCE_KEY_FILE`. Without it the worker reports
  `audit_handoff_enabled: false` and the gateway sends no paid session.
- `up` and `status` print `is_ready` and `audit_handoff_enabled` from the worker's `/session/info`.

## Earlier

- `MIN_CLI` raised to `cli:v0.1.342` (chain runtime 1014020).
- `pin-model`: downloads the Hugging Face commit of Qwen2.5-0.5B-Instruct whose verity-v1 root matches
  the chain record, measured with the official SDK in the official CLI image.
- The model fetch is skipped when the model folder is already filled (the worker re-verifies it).
- `SKIP_SPONSOR=1` skips the sponsor step on a re-run; `MODEL_TRIES` / `MODEL_WAIT` retry the model fetch.

## Running it on a rented Ubuntu VM (Vast.ai)

The script targets WSL, but it also ran on a Vast.ai Ubuntu 22.04 VM (RTX 5060 Ti, calibrated 183):

```
apt-get update && apt-get install -y nvidia-container-toolkit jq tmux
nvidia-ctk runtime configure --runtime=docker && systemctl restart docker
systemctl disable --now unattended-upgrades apt-daily.timer apt-daily-upgrade.timer   # avoid driver/library mismatch
WSL_DISTRO_NAME=flop-miner WORKER_NAME=my-vast-miner GPU_UTIL=0.85 ./flop-miner.sh setup
WSL_DISTRO_NAME=flop-miner ./flop-miner.sh up
```

Skip `harden` (WSL only). Images are still pulled only from `ghcr.io/flop-labs` by digest.
