// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";

const { formatBytes32String } = ethers.utils;

const { SEQUENCER, NETWORK_NAME } = process.env;

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  if (!SEQUENCER || !NETWORK_NAME) {
    throw new Error("Missing required env variables!");
  }

  const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
  const keeper = await DssCronKeeper.deploy(
    SEQUENCER,
    formatBytes32String(NETWORK_NAME)
  );
  await keeper.deployed();
  console.log("DssCronKeeper deployed to:", keeper.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
