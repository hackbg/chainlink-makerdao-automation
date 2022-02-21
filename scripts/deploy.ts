// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers, network } from "hardhat";

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  if (network.name === "mainnet") {
    const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
    const keeper = await DssCronKeeper.deploy(
      "0x9566eB72e47E3E20643C0b1dfbEe04Da5c7E4732", // Sequencer on mainnet
      "chainlink" // tbd
    );
    await keeper.deployed();
    console.log("DssCronKeeper deployed to:", keeper.address);
  } else {
    const Sequencer = await ethers.getContractFactory("Sequencer");
    const sequencer = await Sequencer.deploy();
    console.log("Sequencer deployed to:", sequencer.address);

    await sequencer.file(ethers.utils.formatBytes32String("window"), 2);
    await sequencer.addNetwork(ethers.utils.formatBytes32String("test1"));
    await sequencer.addNetwork(ethers.utils.formatBytes32String("test2"));

    const SampleJob = await ethers.getContractFactory("SampleJob");
    const job = await SampleJob.deploy(sequencer.address, 100);
    console.log("SampleJob deployed to:", job.address);

    await sequencer.addJob(job.address);

    const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
    const keeper = await DssCronKeeper.deploy(
      sequencer.address,
      ethers.utils.formatBytes32String("test1")
    );
    console.log("DssCronKeeper deployed to:", keeper.address);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
