import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumberish, ContractReceipt, Wallet } from "ethers";

import {
  registerUpkeep,
  getRegistrySigners,
  keeperRegistryPerformUpkeep,
  KeeperRegistryParams,
  setupChainlinkAutomation,
} from "../utils/chainlink-automation";
import { parseEventFromABI } from "../utils/events";
import { setupPool } from "../utils/uniswap";
import {
  createVest,
  setupDaiToken,
  setupDssVest,
  setupPaymentAdapter,
  setupSampleJob,
  setupSequencer,
  deployDaiJoinMock,
} from "../utils/maker";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  DssVestMintable,
  ERC20PresetMinterPauser,
  LinkTokenMock,
  Sequencer,
  DssVestTopUp,
  SampleJob,
  KeeperRegistry20,
  KeeperRegistrar20,
  IUniswapV3Pool,
  NetworkPaymentAdapter,
} from "../../typechain";

const { parseEther, parseBytes32String, formatBytes32String } = ethers.utils;

const {
  KEEPER_REGISTRY_LOGIC,
  NONFUNGIBLE_POSITION_MANAGER,
  STAGING_LINK_TOKEN,
  STAGING_LINK_USD_PRICE_FEED,
  STAGING_PAYMENT_USD_PRICE_FEED,
  STAGING_SWAP_ROUTER,
  STAGING_UNISWAP_V3_FACTORY,
  VOW,
} = process.env;

const DssCronKeeperParams = {
  NETWORK_NAME: formatBytes32String("test"),
};

const SequencerParams = {
  WINDOW: 1,
};

const SampleJobParams = {
  MAX_DURATION: 100,
};

const DssVestTopUpParams = {
  UNISWAP_POOL_FEE: 3000,
  SLIPPAGE_TOLERANCE: 2,
};

const PaymentAdapterParams = {
  MIN_PAYMENT: parseEther("1"),
  BUFFER_MAX: parseEther("1"),
};

const PoolParams = {
  LINK_TOKEN_LIQUIDITY: parseEther("100"),
  DAI_TOKEN_LIQUIDITY: parseEther("100"),
};

const DaiTokenParams = {
  DEFAULT_ACCOUNT_BALANCE: parseEther("100"),
};

const DssVestParams = {
  CAP: parseEther("100"),
};

const VestPlanParams = {
  ID: 1,
  TOTAL_AMOUNT: parseEther("100"),
  DURATION_IN_SEC: 1,
  CLIFF_PERIOD_IN_SEC: 0,
};

const UpkeepParams = {
  NAME: "test123",
  ADMIN_EMAIL: "test@example.com",
  GAS_LIMIT: 500000,
  INITIAL_FUNDING: parseEther("1"),
  CHECK_DATA: "0x",
  OFFCHAIN_CONFIG: "0x",
};

async function setupDssCronKeeper(sequencer: Sequencer, networkName: string) {
  const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
  const cronKeeper = await DssCronKeeper.deploy(sequencer.address, networkName);
  await sequencer.addNetwork(networkName);
  return cronKeeper;
}

async function deployDssVestTopup(
  upkeepId: BigNumberish,
  registryAddress: string,
  daiTokenAddress: string,
  linkTokenAddress: string,
  paymentUsdPriceFeedAddress: string,
  linkUsdPriceFeedAddress: string,
  swapRouterAddress: string,
  uniswapPoolFee: BigNumberish,
  slippageTolerance: BigNumberish
) {
  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp = await DssVestTopUp.deploy(
    upkeepId,
    registryAddress,
    daiTokenAddress,
    linkTokenAddress,
    paymentUsdPriceFeedAddress,
    linkUsdPriceFeedAddress,
    swapRouterAddress,
    uniswapPoolFee,
    slippageTolerance
  );
  await topUp.deployed();
  return topUp;
}

function parseSwapEvent(tx: ContractReceipt) {
  const swappedDAIEventABI = [
    "event SwappedDaiForLink(uint256 amountIn, uint256 amountOut)",
  ];
  return parseEventFromABI(tx, swappedDAIEventABI);
}

function parseTopUpEvent(tx: ContractReceipt) {
  const topUpEventABI = [
    "event TopUp(uint256 bufferSize, uint256 daiBalance, uint256 daiSent)",
  ];
  return parseEventFromABI(tx, topUpEventABI);
}

function getUpkeepPerformTotalSpent(tx: ContractReceipt) {
  return tx.events?.find((e) => e.event === "UpkeepPerformed")?.args
    ?.totalPayment;
}

describe("E2E", function () {
  let registry: KeeperRegistry20;
  let registrar: KeeperRegistrar20;
  let linkToken: LinkTokenMock;
  let upkeepId: string;
  let owner: SignerWithAddress;
  let registrySigners: Wallet[];
  let dssVest: DssVestMintable;
  let topUp: DssVestTopUp;
  let paymentAdapter: NetworkPaymentAdapter;
  let daiToken: ERC20PresetMinterPauser;
  let job: SampleJob;

  if (
    !STAGING_LINK_TOKEN ||
    !STAGING_LINK_USD_PRICE_FEED ||
    !STAGING_PAYMENT_USD_PRICE_FEED ||
    !STAGING_SWAP_ROUTER ||
    !VOW ||
    !KEEPER_REGISTRY_LOGIC ||
    !STAGING_UNISWAP_V3_FACTORY ||
    !NONFUNGIBLE_POSITION_MANAGER
  ) {
    throw new Error("Missing required env variables!");
  }

  before(async function () {
    [owner] = await ethers.getSigners();
    linkToken = await ethers.getContractAt("LinkTokenMock", STAGING_LINK_TOKEN);
    registrySigners = getRegistrySigners();
  });

  beforeEach(async function () {
    const sequencer = await setupSequencer(SequencerParams.WINDOW);

    daiToken = await setupDaiToken(
      owner,
      DaiTokenParams.DEFAULT_ACCOUNT_BALANCE
    );

    job = await setupSampleJob(sequencer, SampleJobParams.MAX_DURATION);
    dssVest = await setupDssVest(daiToken, DssVestParams.CAP);
    const daiJoinMock = await deployDaiJoinMock(daiToken.address);

    const cronKeeper = await setupDssCronKeeper(
      sequencer,
      DssCronKeeperParams.NETWORK_NAME
    );

    ({ registry, registrar } = await setupChainlinkAutomation(
      owner,
      linkToken,
      KEEPER_REGISTRY_LOGIC
    ));
    upkeepId = await registerUpkeep(
      cronKeeper.address,
      linkToken.address,
      registrar.address,
      owner.address,
      UpkeepParams.ADMIN_EMAIL,
      UpkeepParams.NAME,
      UpkeepParams.GAS_LIMIT,
      UpkeepParams.OFFCHAIN_CONFIG,
      UpkeepParams.INITIAL_FUNDING,
      UpkeepParams.CHECK_DATA
    );

    topUp = await deployDssVestTopup(
      upkeepId,
      registry.address,
      daiToken.address,
      linkToken.address,
      STAGING_PAYMENT_USD_PRICE_FEED,
      STAGING_LINK_USD_PRICE_FEED,
      STAGING_SWAP_ROUTER,
      DssVestTopUpParams.UNISWAP_POOL_FEE,
      DssVestTopUpParams.SLIPPAGE_TOLERANCE
    );

    paymentAdapter = await setupPaymentAdapter(
      dssVest.address,
      VestPlanParams.ID,
      topUp.address,
      daiJoinMock.address,
      VOW,
      PaymentAdapterParams.BUFFER_MAX,
      PaymentAdapterParams.MIN_PAYMENT
    );
    await topUp.setPaymentAdapter(paymentAdapter.address);

    await createVest(
      dssVest,
      paymentAdapter.address,
      VestPlanParams.TOTAL_AMOUNT,
      VestPlanParams.DURATION_IN_SEC,
      VestPlanParams.CLIFF_PERIOD_IN_SEC,
      owner
    );

    await cronKeeper.setUpkeepRefunder(topUp.address);
  });

  describe("Execute jobs", function () {
    it("should have executed job successfully", async function () {
      await keeperRegistryPerformUpkeep(
        registry,
        registrySigners,
        upkeepId,
        KeeperRegistryParams.F
      );

      const [workable, reasonBytes] = await job.workable(
        formatBytes32String("test")
      );
      const reason = parseBytes32String(reasonBytes.padEnd(66, "0"));
      expect(reason).to.equal("Timer hasn't elapsed");
      expect(workable).to.equal(false);
    });

    it("should reduce upkeep balance after job execution", async function () {
      const { balance: preBalance } = await registry.getUpkeep(upkeepId);
      await keeperRegistryPerformUpkeep(
        registry,
        registrySigners,
        upkeepId,
        KeeperRegistryParams.F
      );
      const { balance: postBalance } = await registry.getUpkeep(upkeepId);
      expect(preBalance).to.be.gt(postBalance);
    });
  });

  describe("Refund upkeep", function () {
    let pool: IUniswapV3Pool;

    beforeEach(async function () {
      pool = await setupPool(
        linkToken,
        daiToken,
        owner,
        PoolParams.LINK_TOKEN_LIQUIDITY,
        PoolParams.DAI_TOKEN_LIQUIDITY,
        STAGING_UNISWAP_V3_FACTORY,
        NONFUNGIBLE_POSITION_MANAGER
      );

      await network.provider.send("evm_increaseTime", [
        VestPlanParams.DURATION_IN_SEC,
      ]);
      await network.provider.send("evm_mine");

      expect(
        await pool.liquidity(),
        "no liquidity in link/payment token pool"
      ).to.be.gt(0);

      expect(
        await dssVest.unpaid(VestPlanParams.ID),
        "no accrued tokens in vest"
      ).to.equal(DssVestParams.CAP);
    });

    it("should refund upkeep when balance falls below threshold", async function () {
      const { balance: initialBalance } = await registry
        .connect(ethers.constants.AddressZero)
        .callStatic.getUpkeep(upkeepId);

      // increase threshold above balance so it has to refund upkeep
      await paymentAdapter.file(
        formatBytes32String("bufferMax"),
        parseEther("100")
      );
      expect(await topUp.shouldRefundUpkeep(), "refund not needed").to.eq(true);

      const tx = await keeperRegistryPerformUpkeep(
        registry,
        registrySigners,
        upkeepId,
        KeeperRegistryParams.F
      );

      const { balance } = await registry
        .connect(ethers.constants.AddressZero)
        .callStatic.getUpkeep(upkeepId);

      const { daiSent } = parseTopUpEvent(tx);
      const { amountIn, amountOut } = parseSwapEvent(tx);
      const performUpkeepLinkSpent = getUpkeepPerformTotalSpent(tx);

      expect(daiSent, "dai received wasn't used").eq(amountIn);

      expect(
        initialBalance.add(amountOut).sub(performUpkeepLinkSpent),
        "swapped link amount not refunded to upkeep"
      ).eq(balance);
    });
  });
});
