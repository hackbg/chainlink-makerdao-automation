# Chainlink Keepers Contracts for MakerDAO

[Chainlink Keepers](https://docs.chain.link/docs/chainlink-keepers/introduction) implementation for [MIP63: Maker Keeper Network](https://forum.makerdao.com/t/mip63-maker-keeper-network/12091).

Maintains Maker protocol by poking oracles, liquidating vaults, managing the autoline, managing D3Ms, etc.

## Overview

![Architecture](/docs/overview.png)

## Setup

Clone the repo and install all dependencies:

```bash
git clone git@github.com:hackbg/chainlink-makerdao-keepers.git
cd chainlink-makerdao-keepers

git submodule init
git submodule update

npm install
```

Copy the `.env.example` to `.env` file and make sure you've set all of the following:

| Name                             | Description                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RPC_URL`                        | URL of the node                                                                                                                                                                                    |
| `PRIVATE_KEY`                    | Controls which account Hardhat uses                                                                                                                                                                |
| `ETHERSCAN_API_KEY`              | Required to verify contract code on Etherscan                                                                                                                                                      |
| `SEQUENCER`                      | Address of [Sequencer](https://github.com/makerdao/dss-cron/)                                                                                                                                      |
| `NETWORK_NAME`                   | Short name from the Sequencer network registry                                                                                                                                                     |
| `DSS_VEST`                       | Address of [DssVest](https://github.com/makerdao/dss-vest)                                                                                                                                         |
| `DAI_JOIN`                       | Address of [DaiJoin](https://docs.makerdao.com/smart-contract-modules/collateral-module/join-detailed-documentation#3-key-mechanisms-and-concepts)                                                 |
| `VOW`                            | Address of [Vow](https://docs.makerdao.com/smart-contract-modules/system-stabilizer-module/vow-detailed-documentation)                                                                             |
| `PAYMENT_TOKEN`                  | Address of ERC-20 token used for payment in DssVest, like DAI                                                                                                                                      |
| `KEEPER_REGISTRY`                | Address of KeeperRegistry                                                                                                                                                                          |
| `SWAP_ROUTER`                    | Address of Uniswap V3 Router                                                                                                                                                                       |
| `LINK_TOKEN`                     | Address of ERC-20 token used for payment in KeeperRegistry, like LINK                                                                                                                              |
| `PAYMENT_USD_PRICE_FEED`         | Chainlink price feed for the DAI / USD pair or the associated `PAYMENT_TOKEN` and USD                                                                                                              |
| `LINK_USD_PRICE_FEED`            | Chainlink price feed for the LINK / USD pair                                                                                                                                                       |
| `MIN_WITHDRAW_AMT`               | Minimum amount of `PAYMENT_TOKOEN` required to trigger top up                                                                                                                                      |
| `MAX_DEPOSIT_AMT`                | Maximum amount of `PAYMENT_TOKOEN` allowed to fund an upkeep. The excess amount is returned to the [Surplus Buffer](https://manual.makerdao.com/parameter-index/core/param-system-surplus-buffer). |
| `BALANCE_THRESHOLD`              | Upkeep LINK balance threshold                                                                                                                                                                      |
| `STAGING_KEEPER_REGISTRY`        | Address of KeeperRegistry on testnet for staging environment                                                                                                                                       |
| `STAGING_KEEPER_REGISTRAR`        | Address of KeeperRegistrar on testnet used for automatically registering Upkeeps for staging environment. The deployer account needs to have enough LINK balance for the initial funding.                                                                                                                                       |
| `STAGING_SWAP_ROUTER`            | Address of Uniswap V3 Router on testnet                                                                                                                                                            |
| `STAGING_LINK_TOKEN`             | Address of ERC-20 token like LINK on testnet                                                                                                                                                       |
| `STAGING_PAYMENT_USD_PRICE_FEED` | Chainlink price feed for the DAI / USD pair on testnet                                                                                                                                             |
| `STAGING_LINK_USD_PRICE_FEED`    | Chainlink price feed for the LINK / USD pair on testnet                                                                                                                                            |

Note: All example values are the actual values for Ethereum Mainnet and the staging ones for Kovan testnet.

## Test

Run unit tests on the local Hardhat network:

```bash
npm run test
```

To test on a live keeper network, deploy a staging environment on a testnet like Kovan:

```bash
npx hardhat run scripts/deploy_staging.ts --network kovan
```

## Deploy

Run the following to deploy `DssVestCronKeeper.sol` and `DssVestTopUp.sol` to a network configured in Hardhat config:

```bash
npx hardhat run scripts/deploy_keeper.ts --network <network>
npx hardhat run scripts/deploy_topup.ts --network <network>
```

After successful deployment, `DssVestCronKeeper` must be [registered as new Upkeep](https://docs.chain.link/docs/chainlink-keepers/register-upkeep/) to start performing pending jobs for the configured `SEQUENCER` and `NETWORK_NAME`.

To enable the Upkeep auto refunding, `DssVestCronKeeper` must be linked to a `DssVestTopUp` instance.

Prior to that, the deployed `DssVestTopUp` must be initialized with `vestId` and `upkeepId` by calling the respective setter functions. To acquire `vestId`, a new application must be [submitted to MakerDAO](https://forum.makerdao.com/t/mip63-maker-keeper-network/12091). The `upkeepId` is available after registering a new Upkeep.

When `DssVestTopUp` is ready, call `setUpkeepRefunder(address)` on the `DssCronKeeper` instance to finalize the setup.

Note: all setter functions must be called from the contract owner account, which is the deployer account if not changed afterwards.

## References

- [MakerDAO](https://makerdao.com/en/)
- [Chainlink Keepers Docs](https://docs.chain.link/docs/chainlink-keepers/introduction/)
