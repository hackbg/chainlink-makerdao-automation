import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  DaiJoinMock,
  DssVestMintable,
  DssVestTopUp,
  ERC20PresetMinterPauser,
  KeeperRegistryMock,
  SwapRouterMock,
} from "../typechain";

const { formatBytes32String, toUtf8Bytes, keccak256 } = ethers.utils;

const fakeVow = "0xA950524441892A31ebddF91d3cEEFa04Bf454466";

describe("DssVestTopUp", function () {
  const minWithdrawAmt = BigNumber.from(100);
  const maxDepositAmt = BigNumber.from(1000);
  const initialUpkeepBalance = BigNumber.from(150);
  const threshold = BigNumber.from(1000);
  const paymentUsdPrice = 1;
  const linkUsdPrice = 5;
  const usdFeedDecimals = 8;

  let topUp: DssVestTopUp;
  let dssVest: DssVestMintable;
  let vestId: BigNumber;
  let token: ERC20PresetMinterPauser;
  let linkToken: ERC20PresetMinterPauser;
  let keeperRegistryMock: KeeperRegistryMock;
  let daiJoinMock: DaiJoinMock;
  let swapRouterMock: SwapRouterMock;
  let slippageTolerancePercentage: number;

  let admin: SignerWithAddress;
  let user: SignerWithAddress;

  before(async function () {
    [admin, user] = await ethers.getSigners();
  });

  beforeEach(async function () {
    // setup dss-vest
    const ERC20 = await ethers.getContractFactory("ERC20PresetMinterPauser");
    token = await ERC20.deploy("Test", "TST");
    const DssVest = await ethers.getContractFactory("DssVestMintable");
    dssVest = await DssVest.deploy(token.address);
    await dssVest.file(formatBytes32String("cap"), 1000);
    await token.grantRole(
      keccak256(toUtf8Bytes("MINTER_ROLE")),
      dssVest.address
    );

    linkToken = await ERC20.deploy("Chainlink", "LINK");

    const DaiJoinMock = await ethers.getContractFactory("DaiJoinMock");
    daiJoinMock = await DaiJoinMock.deploy();

    // setup chainlink keeper registry mock
    const KeeperRegistryMock = await ethers.getContractFactory(
      "KeeperRegistryMock"
    );
    keeperRegistryMock = await KeeperRegistryMock.deploy();
    await keeperRegistryMock.setUpkeepBalance(initialUpkeepBalance);

    // setup uniswap router mock
    const SwapRouterMock = await ethers.getContractFactory("SwapRouterMock");
    swapRouterMock = await SwapRouterMock.deploy();

    // setup price feed mocks
    const MockV3Aggregator = await ethers.getContractFactory(
      "MockV3Aggregator"
    );
    const paymentUsdPriceFeedMock = await MockV3Aggregator.deploy(
      usdFeedDecimals,
      paymentUsdPrice
    );
    const linkUsdPriceFeedMock = await MockV3Aggregator.deploy(
      usdFeedDecimals,
      linkUsdPrice
    );

    // setup topup contract
    const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
    topUp = await DssVestTopUp.deploy(
      dssVest.address,
      daiJoinMock.address,
      fakeVow,
      token.address,
      keeperRegistryMock.address,
      swapRouterMock.address,
      linkToken.address,
      paymentUsdPriceFeedMock.address,
      linkUsdPriceFeedMock.address,
      minWithdrawAmt,
      maxDepositAmt,
      threshold
    );
    await topUp.setUpkeepId(1);
    slippageTolerancePercentage = await topUp.uniswapSlippageTolerancePercent();

    // create vest for topup contract
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    const now = block.timestamp;
    const createVestTx = await dssVest.create(
      topUp.address,
      10000,
      now,
      1000,
      100,
      admin.address
    );
    const createVestRc = await createVestTx.wait();
    const createVestEvent = createVestRc.events?.find(
      (e) => e.event === "Init"
    );
    const [createVestValue] = createVestEvent?.args || [];
    vestId = createVestValue;
    await topUp.setVestId(vestId);
  });

  describe("checker", function () {
    it("should return false if balance > threshold", async function () {
      expect(await topUp.shouldRefundUpkeep()).to.eq(false);
    });

    it("should return false if unpaid < minWithdrawAmt", async function () {
      await keeperRegistryMock.setUpkeepBalance(50);
      expect(await topUp.shouldRefundUpkeep()).to.eq(false);
    });

    it("should return true if balance < threshold and unpaid > minWithdrawAmt", async function () {
      await keeperRegistryMock.setUpkeepBalance(50);
      await network.provider.send("evm_increaseTime", [100]);
      await network.provider.send("evm_mine");

      expect(await topUp.shouldRefundUpkeep()).to.eq(true);
    });

    it("should return true if balance < threshold and preBalance > minWithdrawAmt while unpaid < minWithdrawAmt", async function () {
      await keeperRegistryMock.setUpkeepBalance(50);
      await token.mint(topUp.address, 1000);

      expect(await topUp.shouldRefundUpkeep()).to.eq(true);
    });
  });

  describe("topUp", function () {
    context("accrued tokens", async function () {
      beforeEach(async function () {
        await network.provider.send("evm_increaseTime", [1000]);
        await network.provider.send("evm_mine");
      });

      it("should vest accrued tokens", async function () {
        const unpaid = await dssVest.unpaid(vestId);
        await topUp.refundUpkeep();
        const vested = await token.balanceOf(topUp.address);

        expect(unpaid).to.eq(vested);
      });

      it("should return excess payment to surplus buffer", async function () {
        const unpaid = await dssVest.unpaid(vestId);
        const topUpTx = await topUp.refundUpkeep();

        // get join event data from mock
        const topUpRc = await topUpTx.wait();
        const joinEvent = topUpRc.events?.find(
          (e) => e.address === daiJoinMock.address
        );
        const abiCoder = new ethers.utils.AbiCoder();
        const [vowAddr, joinAmt] = abiCoder.decode(
          ["address", "uint256"],
          joinEvent?.data || ""
        );

        expect(vowAddr).to.eq(fakeVow);
        expect(joinAmt).to.eq(unpaid.sub(maxDepositAmt));
      });

      it("should fund upkeep", async function () {
        await topUp.refundUpkeep();

        const upkeepInfo = await keeperRegistryMock.getUpkeep(0);
        expect(upkeepInfo.balance).to.eq(
          maxDepositAmt.add(initialUpkeepBalance)
        );
      });

      it("should swap with slippage protection", async function () {
        const refundTx = await topUp.refundUpkeep();

        // get event data from mock
        const refundRc = await refundTx.wait();
        const callMockEvent = refundRc.events?.find(
          (e) => e.address === swapRouterMock.address
        );
        const abiCoder = new ethers.utils.AbiCoder();
        const [amountIn, amountOutMinimum] = abiCoder.decode(
          ["uint256", "uint256"],
          callMockEvent?.data || ""
        );

        const paymentLinkPrice = paymentUsdPrice / linkUsdPrice;
        const linkAmtOut = amountIn * paymentLinkPrice;
        const expectedLinkOutWithSlippage =
          linkAmtOut - (linkAmtOut * slippageTolerancePercentage) / 100;

        expect(amountOutMinimum).to.eq(expectedLinkOutWithSlippage);
      });
    });

    it("should fund with emergency topup", async function () {
      await token.mint(topUp.address, minWithdrawAmt);
      await topUp.refundUpkeep();

      const upkeepInfo = await keeperRegistryMock.getUpkeep(0);
      expect(upkeepInfo.balance).to.eq(initialUpkeepBalance.add(100));
    });

    it("should fail if emergency topup below threshold", async function () {
      await token.mint(topUp.address, 1);
      await expect(topUp.refundUpkeep()).to.be.revertedWith(
        "refund not needed"
      );
    });

    it("should not top up if not needed", async function () {
      await expect(topUp.refundUpkeep()).to.be.revertedWith(
        "refund not needed"
      );
    });
  });

  describe("Owner", async function () {
    it("should update slippage tolerance percent", async function () {
      const oldSlippagePercent = await topUp.uniswapSlippageTolerancePercent();
      await topUp.setSlippageTolerancePercent(5);
      const newSlippagePercent = await topUp.uniswapSlippageTolerancePercent();
      expect(oldSlippagePercent).to.not.eq(newSlippagePercent);
    });

    it("should update pool fee", async function () {
      const oldPoolFee = await topUp.uniswapPoolFee();
      await topUp.setUniswapPoolFee(10000);
      const newPoolFee = await topUp.uniswapPoolFee();
      expect(oldPoolFee).to.not.eq(newPoolFee);
    });

    it("should not allow user to update slippage tolerance percent", async function () {
      await expect(
        topUp.connect(user).setSlippageTolerancePercent(1)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should not allow user to update pool fee", async function () {
      await expect(topUp.connect(user).setUniswapPoolFee(1)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("should change keeper registry", async function () {
      const oldKeeperRegistry = await topUp.keeperRegistry();

      await topUp.setKeeperRegistry(admin.address);
      const newKeeperRegistry = await topUp.keeperRegistry();

      expect(oldKeeperRegistry).to.not.eq(newKeeperRegistry);
    });

    it("should not allow owner change keeper registry", async function () {
      await expect(
        topUp.connect(user).setKeeperRegistry(admin.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
