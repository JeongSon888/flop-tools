# Changes in this copy

Based on [Makabeez/flop-pc-miner](https://github.com/Makabeez/flop-pc-miner) v1.0.0 (commit fa33e61, MIT).
The original LICENSE and README are kept. Only `flop-miner.sh` changed (VERSION `1.0.0-son.7`):

- **Evidence store** (needed by miner-worker v0.1.336 and later for paid sessions): `setup` and `up` create
  `/opt/flop-miner/audit-key/evidence.key` once (root, 600), and the worker gets
  `SESSION_AUDIT_EVIDENCE_DIR` and `SESSION_AUDIT_EVIDENCE_KEY_FILE`. Without it the worker reports
  `audit_handoff_enabled: false` and the gateway sends no paid session.
- `up` and `status` print `is_ready` and `audit_handoff_enabled` from the worker's `/session/info`.
- `MIN_CLI` raised to `cli:v0.1.342` (chain runtime 1014020).
- `pin-model`: downloads the Hugging Face commit of Qwen2.5-0.5B-Instruct whose verity-v1 root matches
  the chain record, measured with the official SDK in the official CLI image.
- The model fetch is skipped when the model folder is already filled (the worker re-verifies it).
- `SKIP_SPONSOR=1` skips the sponsor step on a re-run; `MODEL_TRIES` / `MODEL_WAIT` retry the model fetch.

Images are still pulled only from `ghcr.io/flop-labs` by digest.
