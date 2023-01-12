import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";

dotenv.config();

const GOERLI_RPC_URL: string = process.env.GOERLI_URL || "";
const BLOCK_NUMBER: number = parseInt(process.env.BLOCK_NUMBER!);

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            runs: 200,
            enabled: true,
          },
        },
      },
      {
        version: "0.8.6",
        settings: {
          optimizer: {
            runs: 200,
            enabled: true,
          },
        },
      },
      {
        version: "0.7.6",
      },
      {
        version: "0.7.0",
      },
      {
        version: "0.6.12",
      },
    ],
  },
  networks: {
    goerli: {
      url: GOERLI_RPC_URL,
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    mainnet: {
      url: process.env.MAINNET_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

if (process.env.FORK_ENABLED === "true") {
  config.networks!.hardhat = {
    forking: {
      url: GOERLI_RPC_URL,
      blockNumber: BLOCK_NUMBER,
    },
  };
}

export default config;
