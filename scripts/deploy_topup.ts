// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";
import { ProcessEnv } from "../types";

const { parseEther } = ethers.utils;

const {
  DSS_VEST,
  DAI_JOIN,
  VOW,
  PAYMENT_TOKEN,
  KEEPER_REGISTRY,
  SWAP_ROUTER,
  LINK_TOKEN,
  PAYMENT_USD_PRICE_FEED,
  LINK_USD_PRICE_FEED,
  MIN_WITHDRAW_AMT,
  MAX_DEPOSIT_AMT,
  BALANCE_THRESHOLD,
} = process.env as ProcessEnv;

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  if (
    !DSS_VEST ||
    !DAI_JOIN ||
    !VOW ||
    !PAYMENT_TOKEN ||
    !KEEPER_REGISTRY ||
    !SWAP_ROUTER ||
    !LINK_TOKEN ||
    !PAYMENT_USD_PRICE_FEED ||
    !LINK_USD_PRICE_FEED ||
    !MIN_WITHDRAW_AMT ||
    !MAX_DEPOSIT_AMT ||
    !BALANCE_THRESHOLD
  ) {
    throw new Error("Missing required env variables!");
  }

  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp = await DssVestTopUp.deploy(
    DSS_VEST,
    DAI_JOIN,
    VOW,
    PAYMENT_TOKEN,
    KEEPER_REGISTRY,
    SWAP_ROUTER,
    LINK_TOKEN,
    PAYMENT_USD_PRICE_FEED,
    LINK_USD_PRICE_FEED,
    parseEther(MIN_WITHDRAW_AMT),
    parseEther(MAX_DEPOSIT_AMT),
    parseEther(BALANCE_THRESHOLD)
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
