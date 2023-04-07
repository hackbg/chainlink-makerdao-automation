import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "@ethersproject/abi";
import {
  DssVestTopUp,
  ERC20PresetMinterPauser,
  KeeperRegistryMock,
  NetworkPaymentAdapterMock,
  SwapRouterMock,
} from "../../typechain";

const { parseEther, parseUnits, toUtf8Bytes, keccak256 } = ethers.utils;

describe("DssVestTopUp", function () {
  const initialUpkeepBalance = parseEther("1");
  const topUpAmount = parseEther("1");
  const usdFeedDecimals = 8;
  const daiUsdPrice = parseUnits("1", usdFeedDecimals);
  const linkUsdPrice = parseUnits("5", usdFeedDecimals);
  const fakeUpkeepId = 1;
  const uniswapPath = ethers.constants.HashZero;
  const slippageToleranceBps = 100;

  let topUp: DssVestTopUp;
  let paymentAdapterMock: NetworkPaymentAdapterMock;
  let daiToken: ERC20PresetMinterPauser;
  let linkToken: ERC20PresetMinterPauser;
  let keeperRegistryMock: KeeperRegistryMock;
  let swapRouterMock: SwapRouterMock;

  beforeEach(async function () {
    // setup dai token
    const ERC20PresetMinterPauser = await ethers.getContractFactory(
      "ERC20PresetMinterPauser"
    );
    daiToken = await ERC20PresetMinterPauser.deploy("Test DAI", "DAI");

    // setup link token
    linkToken = await ERC20PresetMinterPauser.deploy("Test Chainlink", "LINK");

    // setup chainlink keeper registry mock
    const KeeperRegistryMock = await ethers.getContractFactory(
      "KeeperRegistryMock"
    );
    keeperRegistryMock = await KeeperRegistryMock.deploy(linkToken.address);
    await keeperRegistryMock.setUpkeepBalance(initialUpkeepBalance);

    // setup uniswap router mock
    const SwapRouterMock = await ethers.getContractFactory("SwapRouterMock");
    swapRouterMock = await SwapRouterMock.deploy(
      daiToken.address,
      linkToken.address
    );

    // setup price feed mocks
    const MockV3Aggregator = await ethers.getContractFactory(
      "MockV3Aggregator"
    );
    const daiUsdPriceFeedMock = await MockV3Aggregator.deploy(
      usdFeedDecimals,
      daiUsdPrice
    );
    const linkUsdPriceFeedMock = await MockV3Aggregator.deploy(
      usdFeedDecimals,
      linkUsdPrice
    );

    // setup payment adapter mock
    const NetworkPaymentAdapterMock = await ethers.getContractFactory(
      "NetworkPaymentAdapterMock"
    );
    paymentAdapterMock = await NetworkPaymentAdapterMock.deploy(
      daiToken.address,
      topUpAmount
    );

    // setup topup contract
    const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
    topUp = await DssVestTopUp.deploy(
      fakeUpkeepId,
      keeperRegistryMock.address,
      daiToken.address,
      linkToken.address,
      paymentAdapterMock.address,
      daiUsdPriceFeedMock.address,
      linkUsdPriceFeedMock.address,
      swapRouterMock.address,
      slippageToleranceBps,
      uniswapPath
    );

    // set topup contract as treasury in payment adapter
    paymentAdapterMock.setTreasury(topUp.address);

    // allowing payment adapter mock to simulate dai transfer
    await daiToken.grantRole(
      keccak256(toUtf8Bytes("MINTER_ROLE")),
      paymentAdapterMock.address
    );

    // allowing swap router mock to simulate link transfer
    await linkToken.grantRole(
      keccak256(toUtf8Bytes("MINTER_ROLE")),
      swapRouterMock.address
    );
  });

  describe("Refund upkeep", function () {
    it("should check if refund is needed", async function () {
      expect(await topUp.shouldRefundUpkeep()).to.eq(true);
    });

    it("should refund upkeep", async function () {
      expect(await topUp.refundUpkeep())
        .to.emit(topUp, "UpkeepRefunded")
        .withArgs(topUpAmount);
    });

    it("should update upkeep balance", async function () {
      await topUp.refundUpkeep();

      const upkeepInfo = await keeperRegistryMock.getUpkeep(fakeUpkeepId);

      expect(upkeepInfo.balance).to.eq(initialUpkeepBalance.add(topUpAmount));
    });

    it("should swap DAI for LINK", async function () {
      // SwapRouterMock swaps 1-to-1
      const expectedDaiAmountIn = topUpAmount;
      const expectedLinkAmountOut = expectedDaiAmountIn;

      await expect(topUp.refundUpkeep())
        .to.emit(topUp, "SwappedDaiForLink")
        .withArgs(expectedDaiAmountIn, expectedLinkAmountOut);
    });

    it("should swap with slippage protection", async function () {
      const refundTx = await topUp.refundUpkeep();

      // get event data from mock
      const refundRc = await refundTx.wait();
      const callMockEvent = refundRc.events?.find(
        (e) => e.address === swapRouterMock.address
      );
      const abiCoder = new AbiCoder();
      const [daiAmountIn, linkAmountOutMinimum] = abiCoder.decode(
        ["uint256", "uint256"],
        callMockEvent?.data || ""
      );

      const daiLinkPrice = daiUsdPrice
        .mul(10 ** usdFeedDecimals)
        .div(linkUsdPrice);

      const linkAmountOut = daiAmountIn
        .mul(daiLinkPrice)
        .div(10 ** usdFeedDecimals);

      const expectedLinkOutWithSlippage = linkAmountOut.sub(
        linkAmountOut.mul(slippageToleranceBps).div(10000)
      );

      expect(linkAmountOutMinimum).to.eq(expectedLinkOutWithSlippage);
    });
  });

  describe("Network treasury", function () {
    it("should return correct buffer size", async function () {
      const bufferSize = await topUp.getBufferSize();
      const upkeepInfo = await keeperRegistryMock.getUpkeep(fakeUpkeepId);

      const linkDaiPrice = linkUsdPrice
        .mul(10 ** usdFeedDecimals)
        .div(daiUsdPrice);

      const balanceInDai = upkeepInfo.balance
        .mul(linkDaiPrice)
        .div(10 ** usdFeedDecimals);

      expect(bufferSize).to.eq(balanceInDai);
    });
  });
});
