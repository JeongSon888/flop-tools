# flop_devnet

Small Node.js tool for testing the FLOP **devnet** with up to 10 throw-away wallets, and for reading
miner calibration data from the chain. Devnet FLOP has no value.

```
npm install
node devnet_test.mjs setup 10        # create wallets (saved in devnet_wallets.json: keep it private)
node devnet_test.mjs fund            # ask the official faucet (rate-limited)
node devnet_test.mjs spread 2        # share FLOP from wallet 1 to the others
node devnet_test.mjs balances
node devnet_test.mjs run 30 20       # 30 minutes of small transfers, one every 20 s
node devnet_test.mjs report
node devnet_test.mjs miners          # count registered / calibrated miners
node devnet_test.mjs caps [miner]    # network calibrated capacity, distribution, your share and rank
```

RPC: `wss://rpc.devnet.flop.network` (override with `FLOP_RPC`). `devnet_wallets.json` holds mnemonics:
it is in `.gitignore`, never commit or share it.
