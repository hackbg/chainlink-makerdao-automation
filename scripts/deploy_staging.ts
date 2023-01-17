// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { abi as NonfungiblePositionManagerABI } from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import { ProcessEnv } from "../types";
import { registerUpkeep } from "./utils/keepers";
import { addLiquidity, findOrCreatePool } from "./utils/pool";
import { encodePriceSqrt } from "./utils/uniswap";
import { LinkTokenMock } from "../typechain";

const { parseEther, keccak256, formatBytes32String, toUtf8Bytes } =
  ethers.utils;

const {
  STAGING_KEEPER_REGISTRY,
  STAGING_KEEPER_REGISTRAR,
  STAGING_SWAP_ROUTER,
  STAGING_LINK_TOKEN,
  STAGING_PAYMENT_USD_PRICE_FEED,
  STAGING_LINK_USD_PRICE_FEED,
  STAGING_UNISWAP_V3_FACTORY,
  NONFUNGIBLE_POSITION_MANAGER,
} = process.env as ProcessEnv;

const SEQUENCER_WINDOW_IN_BLOCKS = 13;
const PAYMENT_TOKEN_MINT_AMOUNT = parseEther("1000000");
const DSS_VEST_CAP = parseEther("1"); // Maximum per-second issuance token rate

const TopUpParams = {
  MIN_WITHDRAW_AMT_PAYMENT_TOKEN: parseEther("1"),
  MAX_DEPOSIT_AMT_PAYMENT_TOKEN: parseEther("3"),
  THRESHOLD_LINK: parseEther("7"),
};

const VestParams = {
  TOTAL_AMOUNT_VESTING_PLAN: parseEther("100"),
  DURATION_IN_SEC_VESTING_PLAN: 1000,
  CLIFF_PERIOD_IN_SEC: 0,
};

const UpkeepParams = {
  NAME: "test123",
  ADMIN_EMAIL: "test@example.com",
  GAS_LIMIT: 500000,
  INITIAL_FUNDING: ethers.utils.parseEther("8"),
  CHECK_DATA: "0x",
  OFFCHAIN_CONFIG: "0x",
};

const LiquidityParams = {
  LINK_TOKEN_AMOUNT: ethers.utils.parseEther("5"),
  PAYMENT_TOKEN_AMOUNT: ethers.utils.parseEther("5"),
  MINIMUM_LINK_AMOUNT: BigNumber.from(0),
  MINIMUM_PAYMENT_AMOUNT: BigNumber.from(0),
};

const FAKE_VOW_ADDRESS = "0xA950524441892A31ebddF91d3cEEFa04Bf454466";

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  if (
    !STAGING_KEEPER_REGISTRY ||
    !STAGING_KEEPER_REGISTRAR ||
    !STAGING_SWAP_ROUTER ||
    !STAGING_LINK_TOKEN ||
    !STAGING_PAYMENT_USD_PRICE_FEED ||
    !STAGING_LINK_USD_PRICE_FEED ||
    !STAGING_UNISWAP_V3_FACTORY ||
    !NONFUNGIBLE_POSITION_MANAGER
  ) {
    throw new Error("Missing required env variables!");
  }

  const [admin] = await ethers.getSigners();

  // setup link token
  const LinkToken = await ethers.getContractFactory("LinkTokenMock");
  const linkToken: LinkTokenMock = LinkToken.attach(STAGING_LINK_TOKEN);

  // setup dss-cron
  const Sequencer = await ethers.getContractFactory("Sequencer");
  const sequencer = await Sequencer.deploy();
  await sequencer.deployed();
  console.log("Sequencer deployed to:", sequencer.address);
  await sequencer.file(
    formatBytes32String("window"),
    SEQUENCER_WINDOW_IN_BLOCKS
  );
  await sequencer.addNetwork(formatBytes32String("test1"));
  await sequencer.addNetwork(formatBytes32String("test2"));
  const SampleJob = await ethers.getContractFactory("SampleJob");
  const job = await SampleJob.deploy(sequencer.address, 100);
  await job.deployed();
  console.log("SampleJob deployed to:", job.address);
  await sequencer.addJob(job.address);
  const job2 = await SampleJob.deploy(sequencer.address, 200);
  await job2.deployed();
  console.log("SampleJob 2 deployed to:", job2.address);
  await sequencer.addJob(job2.address);

  const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
  const keeper = await DssCronKeeper.deploy(
    sequencer.address,
    formatBytes32String("test1")
  );
  await keeper.deployed();
  console.log("DssCronKeeper deployed to:", keeper.address);

  // setup dss-vest
  const ERC20 = await ethers.getContractFactory("ERC20PresetMinterPauser");
  const paymentToken = await ERC20.deploy("Test", "TST");
  await paymentToken.deployed();
  console.log("Test payment token deployed to:", paymentToken.address);
  await paymentToken.mint(admin.address, PAYMENT_TOKEN_MINT_AMOUNT);
  console.log("Minted Test payment tokens to admin address");
  const DssVest = await ethers.getContractFactory("DssVestMintable");
  const dssVest = await DssVest.deploy(paymentToken.address);
  await dssVest.deployed();
  console.log("DssVest deployed to:", dssVest.address);
  await dssVest.file(formatBytes32String("cap"), DSS_VEST_CAP);
  await paymentToken.grantRole(
    keccak256(toUtf8Bytes("MINTER_ROLE")),
    dssVest.address
  );
  const DaiJoinMock = await ethers.getContractFactory("DaiJoinMock");
  const daiJoinMock = await DaiJoinMock.deploy(paymentToken.address);
  await daiJoinMock.deployed();

  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp = await DssVestTopUp.deploy(
    dssVest.address,
    daiJoinMock.address,
    FAKE_VOW_ADDRESS,
    paymentToken.address,
    STAGING_KEEPER_REGISTRY,
    STAGING_SWAP_ROUTER,
    STAGING_LINK_TOKEN,
    STAGING_PAYMENT_USD_PRICE_FEED,
    STAGING_LINK_USD_PRICE_FEED,
    TopUpParams.MIN_WITHDRAW_AMT_PAYMENT_TOKEN,
    TopUpParams.MAX_DEPOSIT_AMT_PAYMENT_TOKEN,
    TopUpParams.THRESHOLD_LINK
  );
  await topUp.deployed();
  console.log("DssVestTopUp deployed to:", topUp.address);

  // increase slippage tolerance to be able to swap using Test token as payment
  await topUp.setSlippageTolerancePercent(99);

  await keeper.setUpkeepRefunder(topUp.address);
  console.log("DssCronKeeper topUp set to:", topUp.address);

  // create vest for topup contract
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  const now = block.timestamp;
  const createVestTx = await dssVest.create(
    topUp.address,
    VestParams.TOTAL_AMOUNT_VESTING_PLAN,
    now,
    VestParams.DURATION_IN_SEC_VESTING_PLAN,
    VestParams.CLIFF_PERIOD_IN_SEC,
    admin.address
  );
  const createVestRc = await createVestTx.wait();
  const createVestEvent = createVestRc.events?.find((e) => e.event === "Init");
  const [createVestValue] = createVestEvent?.args || [];
  await topUp.setVestId(createVestValue);

  const upkeepId = await registerUpkeep(
    keeper.address,
    STAGING_LINK_TOKEN,
    STAGING_KEEPER_REGISTRAR,
    admin.address,
    UpkeepParams.ADMIN_EMAIL,
    UpkeepParams.NAME,
    UpkeepParams.GAS_LIMIT,
    UpkeepParams.OFFCHAIN_CONFIG,
    UpkeepParams.INITIAL_FUNDING,
    UpkeepParams.CHECK_DATA
  );
  console.log("Upkeep registered for DssCronKeeper with ID", upkeepId);
  await topUp.setUpkeepId(upkeepId);
  console.log("Upkeep ID set to DssVestTopUp contract");

  const ratio = encodePriceSqrt(BigNumber.from(1), BigNumber.from(1));

  const pool = await findOrCreatePool(
    linkToken.address,
    paymentToken.address,
    ratio,
    admin
  );

  console.log("Pool deployed at address: ", pool.address);

  const nonFungiblePositionManager = new ethers.Contract(
    NONFUNGIBLE_POSITION_MANAGER,
    NonfungiblePositionManagerABI,
    admin
  );

  await addLiquidity(
    linkToken,
    paymentToken,
    nonFungiblePositionManager,
    admin,
    LiquidityParams.LINK_TOKEN_AMOUNT,
    LiquidityParams.PAYMENT_TOKEN_AMOUNT,
    LiquidityParams.MINIMUM_LINK_AMOUNT,
    LiquidityParams.MINIMUM_PAYMENT_AMOUNT
  );

  console.log("Liquidity added.");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
