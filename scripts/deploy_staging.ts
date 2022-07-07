// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";
import { ProcessEnv } from "../types";

const { parseEther, keccak256, formatBytes32String, toUtf8Bytes } =
  ethers.utils;

const {
  STAGING_KEEPER_REGISTRY,
  STAGING_SWAP_ROUTER,
  STAGING_LINK_TOKEN,
  STAGING_PAYMENT_USD_PRICE_FEED,
  STAGING_LINK_USD_PRICE_FEED,
} = process.env as ProcessEnv;

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  if (
    !STAGING_KEEPER_REGISTRY ||
    !STAGING_SWAP_ROUTER ||
    !STAGING_LINK_TOKEN ||
    !STAGING_PAYMENT_USD_PRICE_FEED ||
    !STAGING_LINK_USD_PRICE_FEED
  ) {
    throw new Error("Missing required env variables!");
  }

  const [admin] = await ethers.getSigners();

  // setup dss-cron
  const Sequencer = await ethers.getContractFactory("Sequencer");
  const sequencer = await Sequencer.deploy();
  console.log("Sequencer deployed to:", sequencer.address);
  await sequencer.file(formatBytes32String("window"), 10);
  await sequencer.addNetwork(formatBytes32String("test1"));
  await sequencer.addNetwork(formatBytes32String("test2"));
  const SampleJob = await ethers.getContractFactory("SampleJob");
  const job = await SampleJob.deploy(sequencer.address, 100);
  console.log("SampleJob deployed to:", job.address);
  await sequencer.addJob(job.address);

  const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
  const keeper = await DssCronKeeper.deploy(
    sequencer.address,
    formatBytes32String("test1")
  );
  console.log("DssCronKeeper deployed to:", keeper.address);

  // setup dss-vest
  const ERC20 = await ethers.getContractFactory("ERC20PresetMinterPauser");
  const paymentToken = await ERC20.deploy("Test", "TST");
  console.log("Test payment token deployed to:", paymentToken.address);
  await paymentToken.mint(admin.address, parseEther("1000000"));
  console.log("Minted 1000000 Test payment tokens to default address");
  const DssVest = await ethers.getContractFactory("DssVestMintable");
  const dssVest = await DssVest.deploy(paymentToken.address);
  console.log("DssVest deployed to:", dssVest.address);
  await dssVest.file(formatBytes32String("cap"), parseEther("1"));
  await paymentToken.grantRole(
    keccak256(toUtf8Bytes("MINTER_ROLE")),
    dssVest.address
  );
  const DaiJoinMock = await ethers.getContractFactory("DaiJoinMock");
  const daiJoinMock = await DaiJoinMock.deploy();

  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp = await DssVestTopUp.deploy(
    dssVest.address,
    daiJoinMock.address,
    ethers.constants.AddressZero, // vow
    paymentToken.address,
    STAGING_KEEPER_REGISTRY,
    STAGING_SWAP_ROUTER,
    STAGING_LINK_TOKEN,
    STAGING_PAYMENT_USD_PRICE_FEED,
    STAGING_LINK_USD_PRICE_FEED,
    parseEther("0"), // no minWithdraw
    parseEther("10"),
    20
  );
  console.log("DssVestTopUp deployed to:", topUp.address);

  await keeper.setUpkeepRefunder(topUp.address);
  console.log("DssCronKeeper topUp set to:", topUp.address);

  // create vest for topup contract
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  const now = block.timestamp;
  const createVestTx = await dssVest.create(
    topUp.address,
    parseEther("100"), // total amount of vesting plan
    now,
    1000,
    0,
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
