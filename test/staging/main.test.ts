import { BigNumber } from "ethers";
import {
  formatBytes32String,
  keccak256,
  parseEther,
  toUtf8Bytes,
} from "ethers/lib/utils";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { abi as NonfungiblePositionManagerABI } from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import { registerUpkeep } from "../../scripts/utils/keepers";
import { addLiquidity, findOrCreatePool } from "../../scripts/utils/pool";
import { encodePriceSqrt } from "../../scripts/utils/uniswap";
import { DssCronKeeper, DssVestTopUp, LinkTokenMock } from "../../typechain";

describe("E2E", function () {
  let linkToken: LinkTokenMock;
  let keeper: DssCronKeeper;
  let topUp: DssVestTopUp;
  let admin: SignerWithAddress;

  const {
    STAGING_KEEPER_REGISTRY,
    STAGING_KEEPER_REGISTRAR,
    STAGING_SWAP_ROUTER,
    STAGING_LINK_TOKEN,
    STAGING_PAYMENT_USD_PRICE_FEED,
    STAGING_LINK_USD_PRICE_FEED,
    STAGING_UNISWAP_V3_FACTORY,
    NONFUNGIBLE_POSITION_MANAGER,
    VOW,
  } = process.env;

  const SequencerParams = {
    WINDOW_IN_BLOCKS: 13,
  };

  const DssVestParams = {
    // Maximum per-second issuance token rate
    CAP: parseEther("10"),
  };

  const UpkeepParams = {
    NAME: "test123",
    ADMIN_EMAIL: "test@example.com",
    GAS_LIMIT: 500000,
    INITIAL_FUNDING: ethers.utils.parseEther("5"),
    CHECK_DATA: "0x",
    OFFCHAIN_CONFIG: "0x",
  };

  const DssVestTopUpParams = {
    UNISWAP_POOL_FEE: 3000,
    SLIPPAGE_TOLERANCE: 99,
  };

  const VestParams = {
    TOTAL_AMOUNT_VESTING_PLAN: parseEther("100"),
    DURATION_IN_SEC_VESTING_PLAN: 100,
    CLIFF_PERIOD_IN_SEC: 0,
  };

  const LiquidityParams = {
    LINK_TOKEN_AMOUNT: ethers.utils.parseEther("5"),
    PAYMENT_TOKEN_AMOUNT: ethers.utils.parseEther("5"),
    MINIMUM_LINK_AMOUNT: BigNumber.from(0),
    MINIMUM_PAYMENT_AMOUNT: BigNumber.from(0),
  };

  const PaymentAdapterParams = {
    MIN_PAYMENT: parseEther("10"),
    BUFFER_MAX: parseEther("40"),
  };

  if (
    !STAGING_KEEPER_REGISTRY ||
    !STAGING_KEEPER_REGISTRAR ||
    !STAGING_SWAP_ROUTER ||
    !STAGING_LINK_TOKEN ||
    !STAGING_PAYMENT_USD_PRICE_FEED ||
    !STAGING_LINK_USD_PRICE_FEED ||
    !STAGING_UNISWAP_V3_FACTORY ||
    !NONFUNGIBLE_POSITION_MANAGER ||
    !VOW
  ) {
    throw new Error("Missing required env variable(s)!");
  }

  before(async function () {
    [admin] = await ethers.getSigners();

    const LinkToken = await ethers.getContractFactory("LinkTokenMock");
    linkToken = LinkToken.attach(STAGING_LINK_TOKEN);

    // setup dss-cron
    const Sequencer = await ethers.getContractFactory("Sequencer");
    const sequencer = await Sequencer.deploy();
    await sequencer.deployed();

    await sequencer.addNetwork(formatBytes32String("test1"));
    await sequencer.addNetwork(formatBytes32String("test2"));

    await sequencer.file(
      formatBytes32String("window"),
      SequencerParams.WINDOW_IN_BLOCKS
    );

    // setup jobs
    const SampleJob = await ethers.getContractFactory("SampleJob");
    const job = await SampleJob.deploy(sequencer.address, 100);
    await job.deployed();
    console.log("SampleJob deployed to:", job.address);
    await sequencer.addJob(job.address);
    const job2 = await SampleJob.deploy(sequencer.address, 200);
    await job2.deployed();
    console.log("SampleJob 2 deployed to:", job2.address);
    await sequencer.addJob(job2.address);

    // setup cron keeper
    const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
    keeper = await DssCronKeeper.deploy(
      sequencer.address,
      formatBytes32String("test1")
    );
    console.log("DssCronKeeper deployed to:", keeper.address);

    // setup dss-vest
    const ERC20 = await ethers.getContractFactory("ERC20PresetMinterPauser");
    const paymentToken = await ERC20.deploy("Test", "TST");
    await paymentToken.deployed();
    await paymentToken.mint(
      admin.address,
      LiquidityParams.PAYMENT_TOKEN_AMOUNT
    );
    console.log("Test payment token deployed to:", paymentToken.address);

    // setup dss-vest
    const DssVest = await ethers.getContractFactory("DssVestMintable");
    const dssVest = await DssVest.deploy(paymentToken.address);
    await dssVest.deployed();
    console.log("DssVest deployed to:", dssVest.address);

    await dssVest.file(formatBytes32String("cap"), DssVestParams.CAP);
    await paymentToken.grantRole(
      keccak256(toUtf8Bytes("MINTER_ROLE")),
      dssVest.address
    );
    const DaiJoinMock = await ethers.getContractFactory("DaiJoinMock");
    const daiJoinMock = await DaiJoinMock.deploy(paymentToken.address);
    await daiJoinMock.deployed();

    // setup upkeep
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

    // setup topup
    const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");

    topUp = await DssVestTopUp.deploy(
      upkeepId,
      STAGING_KEEPER_REGISTRY,
      paymentToken.address,
      linkToken.address,
      STAGING_PAYMENT_USD_PRICE_FEED,
      STAGING_LINK_USD_PRICE_FEED,
      STAGING_SWAP_ROUTER,
      DssVestTopUpParams.UNISWAP_POOL_FEE,
      DssVestTopUpParams.SLIPPAGE_TOLERANCE
    );
    console.log("DssVestTopUp deployed to:", topUp.address);

    // setup network payment adapter
    const exptectedVestId = 1;
    const NetworkPaymentAdapter = await ethers.getContractFactory(
      "NetworkPaymentAdapter"
    );
    const paymentAdapter = await NetworkPaymentAdapter.deploy(
      dssVest.address,
      exptectedVestId,
      topUp.address,
      daiJoinMock.address,
      VOW
    );
    console.log("NetworkPaymentAdapter deployed to:", paymentAdapter.address);

    await paymentAdapter.file(
      formatBytes32String("bufferMax"),
      PaymentAdapterParams.BUFFER_MAX
    );
    await paymentAdapter.file(
      formatBytes32String("minimumPayment"),
      PaymentAdapterParams.MIN_PAYMENT
    );

    await topUp.setPaymentAdapter(paymentAdapter.address);
    console.log("DssVestTopUp paymentAdapter set to:", paymentAdapter.address);

    // create vest for network
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    const now = block.timestamp;
    await dssVest.create(
      paymentAdapter.address,
      VestParams.TOTAL_AMOUNT_VESTING_PLAN,
      now,
      VestParams.DURATION_IN_SEC_VESTING_PLAN,
      VestParams.CLIFF_PERIOD_IN_SEC,
      admin.address
    );

    await keeper.setUpkeepRefunder(topUp.address);
    console.log("DssCronKeeper upkeep refunder set to:", topUp.address);

    // Setup uniswap pool
    const ratio = encodePriceSqrt(BigNumber.from(1), BigNumber.from(1));
    const pool = await findOrCreatePool(
      linkToken.address,
      paymentToken.address,
      ratio,
      admin
    );
    console.log("Pool deployed at address: ", pool.address);

    // add liquidity
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
    console.log("Liquidity added to pool");
  });

  it("should execute job", async function () {
    const hasExecutedJob = await new Promise((resolve) => {
      keeper.once("ExecutedJob", async function () {
        resolve(true);
      });
    });
    expect(hasExecutedJob).to.eq(true);
  });

  it("should refund upkeep", async function () {
    const hasFundedUpkeep = await new Promise((resolve) => {
      topUp.once("UpkeepRefunded", async function () {
        resolve(true);
      });
    });
    expect(hasFundedUpkeep).to.eq(true);
  });
});
