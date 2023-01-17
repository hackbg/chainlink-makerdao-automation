import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber, ContractReceipt, Event, Wallet } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { keccak256, parseBytes32String, toUtf8Bytes } from "ethers/lib/utils";
import { abi as NonfungiblePositionManagerABI } from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import {
  DaiJoinMock,
  DssCronKeeper,
  DssVestMintable,
  ERC20PresetMinterPauser,
  LinkTokenMock,
  Sequencer,
  DssVestTopUp,
  SampleJob,
} from "../../typechain";
import { KeeperRegistry20 } from "../../typechain/KeeperRegistry20";
import { KeeperRegistrar20 } from "../../typechain/KeeperRegistrar20";
import { ProcessEnv } from "../../types";
import { registerUpkeep } from "../../scripts/utils/keepers";
import {
  configRegistry,
  getRegistrySigners,
  keeperRegistryPerformUpkeep,
} from "../../scripts/utils/keeper-registry";
import { encodePriceSqrt } from "../../scripts/utils/uniswap";
import { addLiquidity, createPool } from "../../scripts/utils/pool";
import { IUniswapV3Pool } from "../../typechain/IUniswapV3Pool";

const { formatBytes32String } = ethers.utils;
const {
  KEEPER_REGISTRY_LOGIC,
  NONFUNGIBLE_POSITION_MANAGER,
  STAGING_LINK_TOKEN,
  STAGING_LINK_USD_PRICE_FEED,
  STAGING_PAYMENT_USD_PRICE_FEED,
  STAGING_SWAP_ROUTER,
  VOW,
} = process.env as ProcessEnv;

const TopUpParams = {
  MIN_WITHDRAW_AMT_PAYMENT_TOKEN: ethers.utils.parseEther("1"),
  MAX_DEPOSIT_AMT_PAYMENT_TOKEN: ethers.utils.parseEther("3"),
  THRESHOLD_LINK: ethers.utils.parseEther("7"),
};

const VestParams = {
  TOTAL_AMOUNT_VESTING_PLAN: ethers.utils.parseEther("100"),
  DURATION_IN_SEC_VESTING_PLAN: 1,
  CLIFF_PERIOD_IN_SEC: 0,
  CAP: ethers.utils.parseEther("100"),
};

const KeeperRegistrarParams = {
  AUTO_APPROVE_CONFIG_TYPE: {
    NONE: 0,
    WHITELIST: 1,
    ALLOW_ALL: 2,
  },
  AUTO_APPROVE_MAX_ALLOWED: BigNumber.from(20),
  MIN_UPKEEP_SPEND: BigNumber.from("1000"),
};

const KeeperRegistryParams = {
  KEEPER_REGISTRY_LOGIC: "0x96d2971f181bf01f7b61f254e0ded20bb1657e7b",
  F: 1,
};

const UpkeepParams = {
  NAME: "test123",
  ADMIN_EMAIL: "test@example.com",
  GAS_LIMIT: 500000,
  INITIAL_FUNDING: ethers.utils.parseEther("8.0"),
  CHECK_DATA: "0x",
  OFFCHAIN_CONFIG: "0x",
};

describe("E2E", function () {
  let cronKeeper: DssCronKeeper;
  let sequencer: Sequencer;
  let registry: KeeperRegistry20;
  let registrar: KeeperRegistrar20;
  let linkToken: LinkTokenMock;
  let upkeepId: string;
  let vestId: BigNumber;
  let owner: SignerWithAddress;
  let registrySigners: Wallet[];
  let dssVest: DssVestMintable;
  let topUp: DssVestTopUp;
  let paymentToken: ERC20PresetMinterPauser;
  let job: SampleJob;
  let daiJoinMock: DaiJoinMock;

  if (
    !STAGING_LINK_TOKEN ||
    !STAGING_LINK_USD_PRICE_FEED ||
    !STAGING_PAYMENT_USD_PRICE_FEED ||
    !STAGING_SWAP_ROUTER ||
    !VOW ||
    !KEEPER_REGISTRY_LOGIC ||
    !NONFUNGIBLE_POSITION_MANAGER
  ) {
    throw new Error("Missing required env variables!");
  }

  before(async function () {
    [owner] = await ethers.getSigners();

    linkToken = await ethers.getContractAt("LinkTokenMock", STAGING_LINK_TOKEN);

    paymentToken = await setupPaymentToken(owner);
    registrySigners = getRegistrySigners();
  });

  beforeEach(async function () {
    sequencer = await setupSequencer();

    job = await setupSampleJob(sequencer);

    cronKeeper = await setupDssCronKeeper(sequencer);

    ({ registry, registrar } = await setupChainlinkAutomation(
      owner,
      linkToken
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

    dssVest = await setupDssVest(paymentToken);

    daiJoinMock = await setupDaiJoin(paymentToken);

    topUp = await setupDssVestTopup(
      dssVest,
      daiJoinMock,
      paymentToken,
      registry,
      linkToken,
      upkeepId,
      cronKeeper,
      VOW,
      STAGING_SWAP_ROUTER,
      STAGING_PAYMENT_USD_PRICE_FEED,
      STAGING_LINK_USD_PRICE_FEED
    );

    vestId = await setupVest(dssVest, topUp, owner, vestId);
  });

  describe("Execute jobs", function () {
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
  });

  describe("Refund upkeep", function () {
    let pool: IUniswapV3Pool;
    let linkTokensLiquidity: BigNumber;
    let paymentTokensLiquidity: BigNumber;

    before(async function () {
      linkTokensLiquidity = ethers.utils.parseEther("100.0");
      paymentTokensLiquidity = ethers.utils.parseEther("100.0");
      pool = await setupPool(
        linkToken,
        paymentToken,
        owner,
        linkTokensLiquidity,
        paymentTokensLiquidity
      );
    });

    beforeEach(async function () {
      await network.provider.send("evm_increaseTime", [
        VestParams.DURATION_IN_SEC_VESTING_PLAN,
      ]);
      await network.provider.send("evm_mine");

      expect(
        await pool.liquidity(),
        "no liquidity in link/payment token pool"
      ).to.be.gt(0);

      expect(
        await dssVest.unpaid(vestId),
        "no accrued tokens in vest"
      ).to.equal(VestParams.CAP);
    });

    it("should refund upkeep when balance falls below threshold", async function () {
      const { balance: preFundBalance } = await registry
        .connect(ethers.constants.AddressZero)
        .callStatic.getUpkeep(upkeepId);

      // increase threshold above balance so it has to refund upkeep
      await topUp.setThreshold(preFundBalance.add(1));

      const tx = await keeperRegistryPerformUpkeep(
        registry,
        registrySigners,
        upkeepId,
        KeeperRegistryParams.F
      );
      const { balance: postFundBalance } = await registry
        .connect(ethers.constants.AddressZero)
        .callStatic.getUpkeep(upkeepId);

      const linkFunded = getLINKFundedToUpkeep(tx);
      const linkSwapped = getLINKSwapped(tx);

      expect(postFundBalance).to.be.gt(preFundBalance);

      expect(linkFunded).to.eq(linkSwapped);
    });
  });
});

function getLINKSwapped(tx: ContractReceipt) {
  const swappedPaymentEventash =
    "0x40a725f3dd6481375fc982c424861eb4977c23f9079391da9c6a45ddcd72c0e0";
  const swappedPaymentEvent = tx.events?.find(
    (e: Event) => e.topics[0] === swappedPaymentEventash
  );
  const ABI = [
    "event SwappedPaymentTokenForLink(uint256 amountIn, uint256 amountOut)",
  ];
  const iface = new ethers.utils.Interface(ABI);
  const { amountOut } = iface.decodeEventLog(
    "SwappedPaymentTokenForLink",
    swappedPaymentEvent?.data!
  );
  return amountOut;
}

function getLINKFundedToUpkeep(tx: ContractReceipt) {
  const upkeepFundedHash =
    "0x65728e8b0492464959587933b48b3fbaf3cd2132de609fb6ac02dc57dc298d5d";

  const upkeepRefundedEvent = tx.events?.find(
    (e: Event) => e.topics[0] === upkeepFundedHash
  );
  const ABI = ["event UpkeepRefunded(uint256 amount)"];
  const iface = new ethers.utils.Interface(ABI);
  const { amount } = iface.decodeEventLog(
    "UpkeepRefunded",
    upkeepRefundedEvent?.data!
  );

  return amount;
}

async function setupPool(
  linkToken: LinkTokenMock,
  paymentToken: ERC20PresetMinterPauser,
  owner: SignerWithAddress,
  linkTokensLiquidity: BigNumber,
  paymentTokensLiquidity: BigNumber
) {
  const oneToOneRatio = encodePriceSqrt(BigNumber.from(1), BigNumber.from(1));

  const pool = await createPool(
    linkToken.address,
    paymentToken.address,
    oneToOneRatio,
    owner
  );

  const nonfungiblePositionManager = new ethers.Contract(
    NONFUNGIBLE_POSITION_MANAGER!,
    NonfungiblePositionManagerABI,
    owner
  );

  const minAmountExpectedLink = linkTokensLiquidity.div(2);
  const minAmountPaymentToken = paymentTokensLiquidity.div(2);

  await addLiquidity(
    linkToken,
    paymentToken,
    nonfungiblePositionManager,
    owner,
    linkTokensLiquidity,
    paymentTokensLiquidity,
    minAmountExpectedLink,
    minAmountPaymentToken
  );
  return pool;
}

async function setupChainlinkAutomation(
  owner: SignerWithAddress,
  linkToken: LinkTokenMock
) {
  const registry = await setupRegistry();

  const registrar = await setupRegistrar(owner, linkToken, registry);

  const signersAddresses = getRegistrySigners().map((signer) => {
    return signer.address;
  });

  const [registrySigner] = getRegistrySigners();
  await configRegistry(
    registry,
    registrar.address,
    signersAddresses,
    KeeperRegistryParams.F
  );

  // fund registrySigner1 with some ETH so it can execute performUpkeep
  await owner.sendTransaction({
    to: registrySigner.address,
    value: ethers.utils.parseEther("1.0"),
  });
  return { registry, registrar };
}

async function setupRegistry() {
  const Registry = await ethers.getContractFactory("KeeperRegistry2_0");
  const registry = (await Registry.deploy(
    KeeperRegistryParams.KEEPER_REGISTRY_LOGIC
  )) as KeeperRegistry20;
  return registry;
}

async function setupDssCronKeeper(sequencer: Sequencer) {
  const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
  const cronKeeper = await DssCronKeeper.deploy(
    sequencer.address,
    formatBytes32String("test")
  );
  return cronKeeper;
}

async function setupSampleJob(sequencer: Sequencer) {
  const SampleJob = await ethers.getContractFactory("SampleJob");
  const job = await SampleJob.deploy(sequencer.address, 100);
  await sequencer.addJob(job.address);
  return job;
}

async function setupSequencer() {
  const Sequencer = await ethers.getContractFactory("Sequencer");
  const sequencer = await Sequencer.deploy();
  await sequencer.file(formatBytes32String("window"), 1);
  await sequencer.addNetwork(formatBytes32String("test"));
  return sequencer;
}

async function setupVest(
  dssVest: DssVestMintable,
  topUp: DssVestTopUp,
  owner: SignerWithAddress,
  vestId: BigNumber
) {
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  const now = block.timestamp;
  const createVestTx = await dssVest.create(
    topUp.address,
    VestParams.TOTAL_AMOUNT_VESTING_PLAN,
    now,
    VestParams.DURATION_IN_SEC_VESTING_PLAN,
    VestParams.CLIFF_PERIOD_IN_SEC,
    owner.address
  );

  const createVestRc = await createVestTx.wait();
  const createVestEvent = createVestRc.events?.find(
    (e: Event) => e.event === "Init"
  );

  const [createVestValue] = createVestEvent?.args || [];
  vestId = createVestValue;
  await topUp.setVestId(vestId);
  return vestId;
}

async function setupDssVestTopup(
  dssVest: DssVestMintable,
  daiJoinMock: DaiJoinMock,
  paymentToken: ERC20PresetMinterPauser,
  registry: KeeperRegistry20,
  linkToken: LinkTokenMock,
  upkeepId: string,
  cronKeeper: DssCronKeeper,
  vow: string,
  stagingSwapRouter: string,
  stagingPaymentUSDPrriceFeed: string,
  stagingLinkUSDPriceFeed: string
) {
  const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
  const topUp: DssVestTopUp = (await DssVestTopUp.deploy(
    dssVest.address,
    daiJoinMock.address,
    vow,
    paymentToken.address,
    registry.address,
    stagingSwapRouter,
    linkToken.address,
    stagingPaymentUSDPrriceFeed,
    stagingLinkUSDPriceFeed,
    TopUpParams.MIN_WITHDRAW_AMT_PAYMENT_TOKEN,
    TopUpParams.MAX_DEPOSIT_AMT_PAYMENT_TOKEN,
    TopUpParams.THRESHOLD_LINK
  )) as DssVestTopUp;
  await topUp.deployed();
  await topUp.setUpkeepId(upkeepId);
  await cronKeeper.setUpkeepRefunder(topUp.address);
  return topUp;
}

async function setupDaiJoin(paymentToken: ERC20PresetMinterPauser) {
  const DaiJoinMock = await ethers.getContractFactory("DaiJoinMock");
  const daiJoinMock = await DaiJoinMock.deploy(paymentToken.address);
  await daiJoinMock.deployed();
  return daiJoinMock;
}

async function setupDssVest(paymentToken: ERC20PresetMinterPauser) {
  const DssVest = await ethers.getContractFactory("DssVestMintable");
  const dssVest: DssVestMintable = await DssVest.deploy(paymentToken.address);
  await dssVest.deployed();
  await dssVest.file(formatBytes32String("cap"), VestParams.CAP);
  await paymentToken.grantRole(
    keccak256(toUtf8Bytes("MINTER_ROLE")),
    dssVest.address
  );
  return dssVest;
}

async function setupRegistrar(
  owner: SignerWithAddress,
  linkToken: LinkTokenMock,
  registry: KeeperRegistry20
) {
  const KeeperRegistrar = await ethers.getContractFactory("KeeperRegistrar2_0");
  const registrar: KeeperRegistrar20 = (await KeeperRegistrar.connect(
    owner
  ).deploy(
    linkToken.address,
    KeeperRegistrarParams.AUTO_APPROVE_CONFIG_TYPE.ALLOW_ALL,
    KeeperRegistrarParams.AUTO_APPROVE_MAX_ALLOWED,
    registry.address,
    KeeperRegistrarParams.MIN_UPKEEP_SPEND
  )) as KeeperRegistrar20;
  return registrar;
}

async function setupPaymentToken(owner: SignerWithAddress) {
  const ERC20 = await ethers.getContractFactory("ERC20PresetMinterPauser");
  const paymentToken: ERC20PresetMinterPauser = await ERC20.deploy(
    "Test",
    "TST"
  );
  await paymentToken.mint(owner.address, ethers.utils.parseEther("100.0"));
  await paymentToken.deployed();
  return paymentToken;
}
