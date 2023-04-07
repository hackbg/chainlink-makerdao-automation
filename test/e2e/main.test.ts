import { expect } from "chai";
import { ethers, network } from "hardhat";
import * as chainlink from "../utils/chainlink-automation";
import { setupPool } from "../utils/uniswap";
import { parseEventFromABI } from "../utils/events";
import { Wallet } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DssVestTopUp } from "../../typechain/DssVestTopUp";
import { NetworkPaymentAdapter } from "../../typechain/NetworkPaymentAdapter";
import { SampleJob } from "../../typechain/SampleJob";
import { ERC20PresetMinterPauser } from "../../typechain/ERC20PresetMinterPauser";
import { LinkTokenMock } from "../../typechain/LinkTokenMock";
import { KeeperRegistry20 } from "../../typechain/KeeperRegistry20";
import { KeeperRegistrar20 } from "../../typechain/KeeperRegistrar20";

const { parseEther, parseBytes32String, formatBytes32String } = ethers.utils;

const keeperRegistryLogicAddress = process.env.KEEPER_REGISTRY_LOGIC;
const positionManagerAddress = process.env.NONFUNGIBLE_POSITION_MANAGER;
const linkTokenAddress = process.env.STAGING_LINK_TOKEN;
const linkUsdPriceFeedAddress = process.env.STAGING_LINK_USD_PRICE_FEED;
const daiUsdPriceFeedAddress = process.env.STAGING_PAYMENT_USD_PRICE_FEED;
const swapRouterAddress = process.env.STAGING_SWAP_ROUTER;
const uniswapV3FactoryAddress = process.env.STAGING_UNISWAP_V3_FACTORY;
const vowAddress = process.env.VOW;

if (
  !keeperRegistryLogicAddress ||
  !positionManagerAddress ||
  !linkTokenAddress ||
  !linkUsdPriceFeedAddress ||
  !daiUsdPriceFeedAddress ||
  !swapRouterAddress ||
  !uniswapV3FactoryAddress ||
  !vowAddress
) {
  throw new Error("Missing required env variable(s)!");
}

describe("E2E", function () {
  const vestingPlanDuration = 1;
  const networkName = formatBytes32String("test");

  let topUp: DssVestTopUp;
  let paymentAdapter: NetworkPaymentAdapter;
  let job: SampleJob;
  let upkeepId: string;
  let daiToken: ERC20PresetMinterPauser;
  let linkToken: LinkTokenMock;
  let registry: KeeperRegistry20;
  let registrar: KeeperRegistrar20;
  let registrySigners: Wallet[];
  let owner: SignerWithAddress;

  before(async function () {
    [owner] = await ethers.getSigners();
    linkToken = await ethers.getContractAt("LinkTokenMock", linkTokenAddress);
    registrySigners = chainlink.getRegistrySigners();
  });

  beforeEach(async function () {
    // setup dai token
    const ERC20 = await ethers.getContractFactory("ERC20PresetMinterPauser");
    daiToken = await ERC20.deploy("Test DAI", "DAI");
    await daiToken.mint(owner.address, parseEther("100"));

    // setup sequencer
    const Sequencer = await ethers.getContractFactory("Sequencer");
    const sequencer = await Sequencer.deploy();
    const SampleJob = await ethers.getContractFactory("SampleJob");
    job = await SampleJob.deploy(sequencer.address, 100);
    await sequencer.addJob(job.address);

    // setup vest
    const DssVest = await ethers.getContractFactory("DssVestMintable");
    const dssVest = await DssVest.deploy(daiToken.address);
    await dssVest.file(formatBytes32String("cap"), parseEther("100"));
    await daiToken.grantRole(
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE")),
      dssVest.address
    );
    const DaiJoinMock = await ethers.getContractFactory("DaiJoinMock");
    const daiJoin = await DaiJoinMock.deploy(daiToken.address);

    // setup cron keeper
    const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
    const cronKeeper = await DssCronKeeper.deploy(
      sequencer.address,
      networkName
    );
    await sequencer.addNetwork(networkName, 1);

    // setup chainlink automation contracts
    ({ registry, registrar } = await chainlink.setupChainlinkAutomation(
      owner,
      linkToken,
      keeperRegistryLogicAddress
    ));

    // register cron keeper as upkeep
    const upkeepName = "test123";
    const upkeepAdminEmail = "test@example.com";
    const upkeepGasLimit = 500000;
    const upkeepInitialFunding = parseEther("1");
    const upkeepCheckData = "0x";
    const upkeepOffchainConfig = "0x";
    upkeepId = await chainlink.registerUpkeep(
      cronKeeper.address,
      linkToken.address,
      registrar.address,
      owner.address,
      upkeepAdminEmail,
      upkeepName,
      upkeepGasLimit,
      upkeepOffchainConfig,
      upkeepInitialFunding,
      upkeepCheckData
    );

    // setup network payment adapter
    const NetworkPaymentAdapter = await ethers.getContractFactory(
      "NetworkPaymentAdapter"
    );
    const vestingPlanId = 1;
    const bufferMax = parseEther("1");
    const minPayment = parseEther("1");
    paymentAdapter = await NetworkPaymentAdapter.deploy(
      dssVest.address,
      daiJoin.address,
      vowAddress
    );
    await paymentAdapter["file(bytes32,uint256)"](
      formatBytes32String("vestId"),
      vestingPlanId
    );
    await paymentAdapter["file(bytes32,uint256)"](
      formatBytes32String("bufferMax"),
      bufferMax
    );
    await paymentAdapter["file(bytes32,uint256)"](
      formatBytes32String("minimumPayment"),
      minPayment
    );

    // setup topup contract
    const uniswapPoolFee = 3000;
    const slippageToleranceBps = 200;
    const uniswapPath = ethers.utils.solidityPack(
      ["address", "uint24", "address"],
      [daiToken.address, uniswapPoolFee, linkToken.address]
    );
    const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
    topUp = await DssVestTopUp.deploy(
      upkeepId,
      registry.address,
      daiToken.address,
      linkToken.address,
      paymentAdapter.address,
      daiUsdPriceFeedAddress,
      linkUsdPriceFeedAddress,
      swapRouterAddress,
      slippageToleranceBps,
      uniswapPath
    );

    // set topup contract as treasury in payment adapter
    await paymentAdapter["file(bytes32,address)"](
      formatBytes32String("treasury"),
      topUp.address
    );

    // create vesting plan
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    const vestingPlanStartTime = block.timestamp;
    const vestingPlanAmount = parseEther("100");
    const vestingPlanCliff = 0;
    await dssVest.create(
      paymentAdapter.address,
      vestingPlanAmount,
      vestingPlanStartTime,
      vestingPlanDuration,
      vestingPlanCliff,
      owner.address
    );

    // enable upkeep auto refunding
    await cronKeeper.setUpkeepRefunder(topUp.address);
  });

  describe("Execute jobs", function () {
    it("should have executed job successfully", async function () {
      const [workableBefore] = await job.workable(networkName);
      expect(workableBefore).to.equal(true);

      await chainlink.keeperRegistryPerformUpkeep(
        registry,
        registrySigners,
        upkeepId,
        chainlink.KeeperRegistryParams.F
      );

      const [workableAfter, reasonBytes] = await job.workable(networkName);
      const reason = parseBytes32String(reasonBytes.padEnd(66, "0"));

      expect(reason).to.equal("Timer hasn't elapsed");
      expect(workableAfter).to.equal(false);
    });

    it("should reduce upkeep balance after job execution", async function () {
      const { balance: preBalance } = await registry.getUpkeep(upkeepId);
      await chainlink.keeperRegistryPerformUpkeep(
        registry,
        registrySigners,
        upkeepId,
        chainlink.KeeperRegistryParams.F
      );
      const { balance: postBalance } = await registry.getUpkeep(upkeepId);
      expect(preBalance).to.be.gt(postBalance);
    });
  });

  describe("Refund upkeep", function () {
    beforeEach(async function () {
      const poolLinkTokenLiquidity = parseEther("100");
      const poolDaiTokenLiquidity = parseEther("100");
      await setupPool(
        linkToken,
        daiToken,
        owner,
        poolLinkTokenLiquidity,
        poolDaiTokenLiquidity,
        uniswapV3FactoryAddress,
        positionManagerAddress
      );
      // advance time to accrue all tokens in vesting plan
      await network.provider.send("evm_increaseTime", [vestingPlanDuration]);
      await network.provider.send("evm_mine");
    });

    it("should refund upkeep when balance falls below threshold", async function () {
      const { balance: initialBalance } = await registry.callStatic.getUpkeep(
        upkeepId
      );
      // increase threshold above balance so it has to refund upkeep
      await paymentAdapter["file(bytes32,uint256)"](
        formatBytes32String("bufferMax"),
        parseEther("100")
      );
      expect(await topUp.shouldRefundUpkeep(), "refund not needed").to.eq(true);

      // do the thing
      const tx = await chainlink.keeperRegistryPerformUpkeep(
        registry,
        registrySigners,
        upkeepId,
        chainlink.KeeperRegistryParams.F
      );

      const { balance } = await registry.callStatic.getUpkeep(upkeepId);

      // get dai transferred from event params of payment adapter
      const topUpEventABI = [
        "event TopUp(uint256 bufferSize, uint256 daiBalance, uint256 daiSent)",
      ];
      const { daiSent } = parseEventFromABI(tx, topUpEventABI);

      // get swap event params from topup contract
      const swappedDAIEventABI = [
        "event SwappedDaiForLink(uint256 amountIn, uint256 amountOut)",
      ];
      const { amountIn, amountOut } = parseEventFromABI(tx, swappedDAIEventABI);

      // get total link spent from event
      const performUpkeepLinkSpent = tx.events?.find(
        (e) => e.event === "UpkeepPerformed"
      )?.args?.totalPayment;

      expect(daiSent).eq(amountIn);
      expect(initialBalance.add(amountOut).sub(performUpkeepLinkSpent)).eq(
        balance
      );
    });
  });
});
