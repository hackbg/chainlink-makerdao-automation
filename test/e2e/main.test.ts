import { expect } from "chai";
import { ethers, network } from "hardhat";
import { impersonateAccount } from "@nomicfoundation/hardhat-network-helpers";
import { setupPool } from "../utils/uniswap";
import { parseEventFromABI } from "../utils/events";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DssVestTopUp } from "../../typechain/DssVestTopUp";
import { DssCronKeeper } from "../../typechain/DssCronKeeper";
import { NetworkPaymentAdapter } from "../../typechain/NetworkPaymentAdapter";
import { SampleJob } from "../../typechain/SampleJob";
import { ERC20PresetMinterPauser } from "../../typechain/ERC20PresetMinterPauser";
import { IKeeperRegistryMaster } from "../../typechain/IKeeperRegistryMaster";
import { LinkToken } from "../../typechain/LinkToken";

const { parseEther, parseBytes32String, formatBytes32String } = ethers.utils;

const linkTokenAddress = process.env.LINK_TOKEN;
const accountWihLink = process.env.EOA_WITH_LINK;
const automationRegistrarAddress = process.env.AUTOMATION_REGISTRAR_V2_1;
const keeperRegistryAddress = process.env.KEEPER_REGISTRY_V2_1;
const positionManagerAddress = process.env.NONFUNGIBLE_POSITION_MANAGER;
const linkUsdPriceFeedAddress = process.env.LINK_USD_PRICE_FEED;
const daiUsdPriceFeedAddress = process.env.DAI_USD_PRICE_FEED;
const swapRouterAddress = process.env.SWAP_ROUTER_V3;
const uniswapV3FactoryAddress = process.env.UNISWAP_V3_FACTORY;
const vowAddress = process.env.VOW;

if (
  !linkTokenAddress ||
  !accountWihLink ||
  !automationRegistrarAddress ||
  !keeperRegistryAddress ||
  !positionManagerAddress ||
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
  let cronKeeper: DssCronKeeper;
  let job: SampleJob;
  let keeperRegistry: IKeeperRegistryMaster;
  let upkeepId: string;
  let daiToken: ERC20PresetMinterPauser;
  let linkToken: LinkToken;
  let owner: SignerWithAddress;

  before(async function () {
    [owner] = await ethers.getSigners();
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
    cronKeeper = await DssCronKeeper.deploy(sequencer.address, networkName);
    await sequencer.addNetwork(networkName, 1);

    // setup link token
    linkToken = await ethers.getContractAt("LinkToken", linkTokenAddress);

    // setup keeper registry
    keeperRegistry = await ethers.getContractAt(
      "IKeeperRegistryMaster",
      keeperRegistryAddress
    );

    // setup automation registrar
    const automationRegistrar = await ethers.getContractAt(
      "AutomationRegistrar2_1",
      automationRegistrarAddress
    );

    // fund default account with link
    await impersonateAccount(accountWihLink);
    const accountWihLinkSigner = await ethers.getSigner(accountWihLink);
    const data = linkToken.interface.encodeFunctionData("transfer", [
      owner.address,
      parseEther("10"),
    ]);
    await accountWihLinkSigner.sendTransaction({
      to: linkToken.address,
      data,
    });

    // register upkeep
    const upkeepFundAmount = parseEther("5");
    await linkToken.approve(automationRegistrarAddress, upkeepFundAmount);
    const upkeepParams = {
      name: "test123",
      encryptedEmail: "0x00",
      upkeepContract: cronKeeper.address,
      gasLimit: 500000,
      adminAddress: owner.address,
      triggerType: 0,
      checkData: "0x00",
      triggerConfig: "0xdeadbeef",
      offchainConfig: "0x00",
      amount: upkeepFundAmount,
    };
    const registerTx = await automationRegistrar.registerUpkeep(upkeepParams);
    const registerRc = await registerTx.wait();
    upkeepId = registerRc.events.find((e) => e.event === "RegistrationApproved")
      .args.upkeepId;

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
      keeperRegistryAddress,
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

  describe("KeeperRegistry", () => {
    it("should check upkeep", async () => {
      const [upkeepNeeded, performData] = await keeperRegistry
        .connect(ethers.constants.AddressZero)
        .callStatic["checkUpkeep(uint256)"](upkeepId);

      expect(upkeepNeeded).to.eq(true);
      expect(performData).to.not.eq("0x");
    });

    it("should perform upkeep", async () => {
      const [, performData] = await keeperRegistry
        .connect(ethers.constants.AddressZero)
        .callStatic["checkUpkeep(uint256)"](upkeepId);

      const [success, gasUsed] = await keeperRegistry
        .connect(ethers.constants.AddressZero)
        .callStatic.simulatePerformUpkeep(upkeepId, performData);

      expect(success).to.eq(true);
      expect(gasUsed).to.be.gt(0);
    });
  });

  describe("Execute jobs", function () {
    it("should execute job successfully", async function () {
      const [workableBefore] = await job.workable(networkName);
      expect(workableBefore).to.equal(true);

      const [, performData] = await cronKeeper.callStatic.checkUpkeep("0x00");
      await cronKeeper.performUpkeep(performData);

      const [workableAfter, reasonBytes] = await job.workable(networkName);
      const reason = parseBytes32String(reasonBytes.padEnd(66, "0"));

      expect(reason).to.equal("Timer hasn't elapsed");
      expect(workableAfter).to.equal(false);
    });
  });

  describe("Refund upkeep", function () {
    beforeEach(async function () {
      const poolLinkTokenLiquidity = parseEther("10");
      const poolDaiTokenLiquidity = parseEther("10");
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
      const { balance: balanceBefore } =
        await keeperRegistry.callStatic.getUpkeep(upkeepId);
      // increase threshold above balance so it has to refund upkeep
      await paymentAdapter["file(bytes32,uint256)"](
        formatBytes32String("bufferMax"),
        parseEther("1000")
      );
      expect(await topUp.shouldRefundUpkeep(), "refund not needed").to.eq(true);

      const [, performData] = await cronKeeper.callStatic.checkUpkeep("0x00");
      const performTx = await cronKeeper.performUpkeep(performData);
      const performRc = await performTx.wait();

      const { balance: balanceAfter } =
        await keeperRegistry.callStatic.getUpkeep(upkeepId);

      // get dai transferred from payment adapter
      const { daiSent } = parseEventFromABI(performRc, [
        "event TopUp(uint256 bufferSize, uint256 daiBalance, uint256 daiSent)",
      ]);

      // get dai/link swap details from topup contract
      const { amountIn, amountOut } = parseEventFromABI(performRc, [
        "event SwappedDaiForLink(uint256 amountIn, uint256 amountOut)",
      ]);

      // check if dai sent from the payment adapter is equal to the amount swapped
      expect(daiSent).eq(amountIn);

      // check if balance is equal to initial balance + amount of link swapped
      expect(balanceBefore.add(amountOut)).eq(balanceAfter);
    });
  });
});
