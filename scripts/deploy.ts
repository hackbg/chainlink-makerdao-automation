// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
  const keeper = await DssCronKeeper.deploy(
    "0x9566eB72e47E3E20643C0b1dfbEe04Da5c7E4732", // Sequencer on mainnet
    "chainlink" // tbd
  );
  await keeper.deployed();
  console.log("DssCronKeeper deployed to:", keeper.address);

  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp = await DssVestTopUp.deploy(
    "", // dss-vest addr ???
    "0x9759a6ac90977b93b58547b4a71c78317f391a28",
    "0xa950524441892a31ebddf91d3ceefa04bf454466",
    "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    "0x7b3EC232b08BD7b4b3305BE0C044D907B2DF960B",
    "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    100, // tbd
    500, // tbd
    10 // tbd
  );
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
