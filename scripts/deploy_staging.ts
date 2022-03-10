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
  const [admin] = await ethers.getSigners();

  // setup dss-cron
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
  // deploy DssCronKeeper
  const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
  const keeper = await DssCronKeeper.deploy(
    sequencer.address,
    ethers.utils.formatBytes32String("test1")
  );
  console.log("DssCronKeeper deployed to:", keeper.address);
  // setup dss-vest
  const ERC20 = await ethers.getContractFactory("ERC20PresetMinterPauser");
  const paymentToken = await ERC20.deploy("Test", "TST");
  console.log("Test payment token deployed to:", paymentToken.address);
  await paymentToken.mint(admin.address, ethers.utils.parseEther("1000000"));
  console.log("Minted 1000000 Test payment tokens to default address");
  const DssVest = await ethers.getContractFactory("DssVestMintable");
  const dssVest = await DssVest.deploy(paymentToken.address);
  console.log("DssVest deployed to:", dssVest.address);
  await dssVest.file(ethers.utils.formatBytes32String("cap"), 1000);
  await paymentToken.grantRole(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE")),
    dssVest.address
  );
  const DaiJoinMock = await ethers.getContractFactory("DaiJoinMock");
  const daiJoinMock = await DaiJoinMock.deploy();
  // deploy DssVestTopUp
  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp = await DssVestTopUp.deploy(
    dssVest.address,
    daiJoinMock.address,
    ethers.constants.AddressZero, // vow
    paymentToken.address,
    "0x4Cb093f226983713164A62138C3F718A5b595F73", // keeper registry on kovan
    "0xE592427A0AEce92De3Edee1F18E0157C05861564", // swap router on kovan
    "0xa36085F69e2889c224210F603D836748e7dC0088", // link token on kovan
    0, // no minWithdraw
    ethers.utils.parseEther("10"),
    ethers.utils.parseEther("7")
  );
  console.log("DssVestTopUp deployed to:", topUp.address);
  await keeper.setTopUp(topUp.address);
  console.log("DssCronKeeper topUp set to:", topUp.address);
  // create vest for topup contract
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  const now = block.timestamp;
  const createVestTx = await dssVest.create(
    topUp.address,
    100000, // total amount of vesting plan
    now,
    1000,
    1,
    admin.address
  );
  const createVestRc = await createVestTx.wait();
  const createVestEvent = createVestRc.events?.find((e) => e.event === "Init");
  const [createVestValue] = createVestEvent?.args || [];
  await topUp.setVestId(createVestValue);

  console.log("TODO: Create a Uniswap pool for Test token and LINK");
  console.log("TODO: Register DssCronKeeper as upkeep");
  console.log("TODO: Once upkeep is approved call DssVestTopUp.setUpkeepId");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
