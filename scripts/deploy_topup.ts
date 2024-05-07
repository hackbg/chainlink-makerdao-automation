// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";

const {
  UPKEEP_ID,
  KEEPER_REGISTRY_V2_1,
  DAI_TOKEN,
  LINK_TOKEN,
  NETWORK_PAYMENT_ADAPTER,
  DAI_USD_PRICE_FEED,
  LINK_USD_PRICE_FEED,
  SWAP_ROUTER_V3,
  SLIPPAGE_TOLERANCE_BPS,
  UNISWAP_PATH,
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
    !KEEPER_REGISTRY_V2_1 ||
    !DAI_TOKEN ||
    !LINK_TOKEN ||
    !NETWORK_PAYMENT_ADAPTER ||
    !DAI_USD_PRICE_FEED ||
    !LINK_USD_PRICE_FEED ||
    !SWAP_ROUTER_V3 ||
    !SLIPPAGE_TOLERANCE_BPS ||
    !UNISWAP_PATH
  ) {
    throw new Error("Missing required env variable(s)!");
  }

  const pathElements = UNISWAP_PATH.split(",").map((el) => el.trim());
  const pathEncoded = ethers.utils.solidityPack(
    pathElements.map((_, idx) => (idx % 2 === 0 ? "address" : "uint24")),
    pathElements
  );

  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp = await DssVestTopUp.deploy(
    UPKEEP_ID,
    KEEPER_REGISTRY_V2_1,
    DAI_TOKEN,
    LINK_TOKEN,
    NETWORK_PAYMENT_ADAPTER,
    DAI_USD_PRICE_FEED,
    LINK_USD_PRICE_FEED,
    SWAP_ROUTER_V3,
    SLIPPAGE_TOLERANCE_BPS,
    pathEncoded
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
