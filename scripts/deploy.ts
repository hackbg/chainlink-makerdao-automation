// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";
import { ProcessEnv } from "../types";

const { parseEther, formatBytes32String } = ethers.utils;

const {
  SEQUENCER,
  NETWORK_NAME,
  DSS_VEST,
  DAI_JOIN,
  VOW,
  PAYMENT_TOKEN,
  KEEPER_REGISTRY,
  SWAP_ROUTER,
  LINK_TOKEN,
  MIN_WITHDRAW_AMT,
  MAX_DEPOSIT_AMT,
  MIN_BALANCE_PREMIUM,
} = process.env as ProcessEnv;

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  if (
    !SEQUENCER ||
    !NETWORK_NAME ||
    !DSS_VEST ||
    !DAI_JOIN ||
    !VOW ||
    !PAYMENT_TOKEN ||
    !KEEPER_REGISTRY ||
    !SWAP_ROUTER ||
    !LINK_TOKEN ||
    !MIN_WITHDRAW_AMT ||
    !MAX_DEPOSIT_AMT ||
    !MIN_BALANCE_PREMIUM
  ) {
    throw new Error("Missing required env variables!");
  }

  const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
  const keeper = await DssCronKeeper.deploy(
    SEQUENCER,
    formatBytes32String(NETWORK_NAME)
  );
  await keeper.deployed();
  console.log("DssCronKeeper deployed to:", keeper.address);

  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp = await DssVestTopUp.deploy(
    DSS_VEST,
    DAI_JOIN,
    VOW,
    PAYMENT_TOKEN,
    KEEPER_REGISTRY,
    SWAP_ROUTER,
    LINK_TOKEN,
    parseEther(MIN_WITHDRAW_AMT),
    parseEther(MAX_DEPOSIT_AMT),
    MIN_BALANCE_PREMIUM
  );
  await topUp.deployed();
  console.log("DssVestTopUp deployed to:", topUp.address);

  keeper.setTopUp(topUp.address);
  console.log("DssCronKeeper topUp set to:", topUp.address);

  console.log("TODO: Create proposal for DssVestTopUp to MakerDAO");
  console.log("TODO: Once approved call DssVestTopUp.setVestId");
  console.log("TODO: Register DssCronKeeper as upkeep");
  console.log("TODO: Once upkeep is approved call DssVestTopUp.setUpkeepId");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
