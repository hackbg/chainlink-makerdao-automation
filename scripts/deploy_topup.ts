// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";

const {
  UPKEEP_ID,
  KEEPER_REGISTRY_V2,
  DAI_TOKEN,
  LINK_TOKEN,
  DAI_USD_PRICE_FEED,
  LINK_USD_PRICE_FEED,
  SWAP_ROUTER_V3,
  UNISWAP_POOL_FEE,
  SLIPPAGE_TOLERANCE_PERCENT,
} = process.env;

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  if (
    !UPKEEP_ID ||
    !KEEPER_REGISTRY_V2 ||
    !DAI_TOKEN ||
    !LINK_TOKEN ||
    !DAI_USD_PRICE_FEED ||
    !LINK_USD_PRICE_FEED ||
    !SWAP_ROUTER_V3 ||
    !UNISWAP_POOL_FEE ||
    !SLIPPAGE_TOLERANCE_PERCENT
  ) {
    throw new Error("Missing required env variable(s)!");
  }

  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp = await DssVestTopUp.deploy(
    UPKEEP_ID,
    KEEPER_REGISTRY_V2,
    DAI_TOKEN,
    LINK_TOKEN,
    DAI_USD_PRICE_FEED,
    LINK_USD_PRICE_FEED,
    SWAP_ROUTER_V3,
    UNISWAP_POOL_FEE,
    SLIPPAGE_TOLERANCE_PERCENT
  );
  await topUp.deployed();
  console.log("DssVestTopUp deployed to:", topUp.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
