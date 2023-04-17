import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "@ethersproject/abi";
import { utils, Wallet } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { DssVestTopUp } from "../../typechain/DssVestTopUp";
import { NetworkPaymentAdapterMock } from "../../typechain/NetworkPaymentAdapterMock";
import { ERC20PresetMinterPauser } from "../../typechain/ERC20PresetMinterPauser";
import { KeeperRegistryMock } from "../../typechain/KeeperRegistryMock";
import { SwapRouterMock } from "../../typechain/SwapRouterMock";
import { DssVestTopUp__factory as DssVestTopUpFactory } from "../../typechain/factories/DssVestTopUp__factory";
import { MockV3Aggregator__factory as MockV3AggregatorFactory } from "../../typechain/factories/MockV3Aggregator__factory";
import { MockV3Aggregator } from "../../typechain/MockV3Aggregator";

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

  let DssVestTopUp: DssVestTopUpFactory;
  let MockV3Aggregator: MockV3AggregatorFactory;
  let linkUsdPriceFeedMock: MockV3Aggregator;
  let daiUsdPriceFeedMock: MockV3Aggregator;
  let paymentAdapterMock: NetworkPaymentAdapterMock;
  let daiToken: ERC20PresetMinterPauser;
  let linkToken: ERC20PresetMinterPauser;
  let keeperRegistryMock: KeeperRegistryMock;
  let swapRouterMock: SwapRouterMock;
  let owner: SignerWithAddress;

  before(async function () {
    DssVestTopUp = (await ethers.getContractFactory(
      "DssVestTopUp"
    )) as unknown as DssVestTopUpFactory;
    MockV3Aggregator = (await ethers.getContractFactory(
      "MockV3Aggregator"
    )) as unknown as MockV3AggregatorFactory;
  });

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    // setup dai token
    const ERC20PresetMinterPauser = await ethers.getContractFactory(
      "ERC20PresetMinterPauser"
    );
    daiToken = (await ERC20PresetMinterPauser.deploy(
      "Test DAI",
      "DAI"
    )) as unknown as ERC20PresetMinterPauser;

    // setup link token
    linkToken = (await ERC20PresetMinterPauser.deploy(
      "Test Chainlink",
      "LINK"
    )) as unknown as ERC20PresetMinterPauser;

    // setup chainlink keeper registry mock
    const KeeperRegistryMock = await ethers.getContractFactory(
      "KeeperRegistryMock"
    );
    keeperRegistryMock = (await KeeperRegistryMock.deploy(
      linkToken.address
    )) as unknown as KeeperRegistryMock;
    await keeperRegistryMock.setUpkeepBalance(initialUpkeepBalance);

    // setup uniswap router mock
    const SwapRouterMock = await ethers.getContractFactory("SwapRouterMock");
    swapRouterMock = (await SwapRouterMock.deploy(
      daiToken.address,
      linkToken.address
    )) as unknown as SwapRouterMock;

    // setup price feed mocks
    daiUsdPriceFeedMock = await MockV3Aggregator.deploy(
      usdFeedDecimals,
      daiUsdPrice
    );
    linkUsdPriceFeedMock = await MockV3Aggregator.deploy(
      usdFeedDecimals,
      linkUsdPrice
    );

    // setup payment adapter mock
    const NetworkPaymentAdapterMock = await ethers.getContractFactory(
      "NetworkPaymentAdapterMock"
    );
    paymentAdapterMock = (await NetworkPaymentAdapterMock.deploy(
      daiToken.address,
      topUpAmount
    )) as unknown as NetworkPaymentAdapterMock;

    // setup topup contract
    const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
    topUp = (await DssVestTopUp.deploy(
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
    )) as unknown as DssVestTopUp;

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

  describe("Deploy", function () {
    it("should correctly set all parameters when successful", async function () {
      expect(await topUp.keeperRegistry()).eq(keeperRegistryMock.address);
      expect(await topUp.upkeepId()).eq(fakeUpkeepId);
      expect(await topUp.daiToken()).eq(daiToken.address);
      expect(await topUp.linkToken()).eq(linkToken.address);
      expect(await topUp.linkToken()).eq(linkToken.address);
      expect(await topUp.paymentAdapter()).eq(paymentAdapterMock.address);
      expect(await topUp.daiUsdPriceFeed()).eq(daiUsdPriceFeedMock.address);
      expect(await topUp.linkUsdPriceFeed()).eq(linkUsdPriceFeedMock.address);
      expect(await topUp.swapRouter()).eq(swapRouterMock.address);
      expect(await topUp.slippageToleranceBps()).eq(slippageToleranceBps);
      expect(await topUp.uniswapPath()).eq(uniswapPath);
    });

    it("should revert if keeper registry is zero address", async function () {
      const invalidKeeperRegistry = ethers.constants.AddressZero;
      await expect(
        DssVestTopUp.deploy(
          fakeUpkeepId,
          invalidKeeperRegistry,
          daiToken.address,
          linkToken.address,
          paymentAdapterMock.address,
          daiUsdPriceFeedMock.address,
          linkUsdPriceFeedMock.address,
          swapRouterMock.address,
          slippageToleranceBps,
          uniswapPath
        )
      ).to.be.revertedWith('InvalidParam("KeeperRegistry")');
    });

    it("should revert if upkeep id is 0", async function () {
      const invalidUpkeepId = 0;
      await expect(
        DssVestTopUp.deploy(
          invalidUpkeepId,
          keeperRegistryMock.address,
          daiToken.address,
          linkToken.address,
          paymentAdapterMock.address,
          daiUsdPriceFeedMock.address,
          linkUsdPriceFeedMock.address,
          swapRouterMock.address,
          slippageToleranceBps,
          ethers.constants.HashZero
        )
      ).to.be.revertedWith('InvalidParam("Upkeep ID")');
    });

    it("should revert if dai token is the zero address", async function () {
      const invalidDaiToken = ethers.constants.AddressZero;
      await expect(
        DssVestTopUp.deploy(
          fakeUpkeepId,
          keeperRegistryMock.address,
          invalidDaiToken,
          linkToken.address,
          paymentAdapterMock.address,
          daiUsdPriceFeedMock.address,
          linkUsdPriceFeedMock.address,
          swapRouterMock.address,
          slippageToleranceBps,
          uniswapPath
        )
      ).to.be.revertedWith('InvalidParam("DAI Token")');
    });

    it("should revert if link token is the zero address", async function () {
      await expect(
        DssVestTopUp.deploy(
          fakeUpkeepId,
          keeperRegistryMock.address,
          daiToken.address,
          ethers.constants.AddressZero,
          paymentAdapterMock.address,
          daiUsdPriceFeedMock.address,
          linkUsdPriceFeedMock.address,
          swapRouterMock.address,
          slippageToleranceBps,
          uniswapPath
        )
      ).to.be.revertedWith('InvalidParam("LINK Token")');
    });

    it("should revert if payment adapter is the zero address", async function () {
      const invalidPaymentAdapter = ethers.constants.AddressZero;
      await expect(
        DssVestTopUp.deploy(
          fakeUpkeepId,
          keeperRegistryMock.address,
          daiToken.address,
          linkToken.address,
          invalidPaymentAdapter,
          daiUsdPriceFeedMock.address,
          linkUsdPriceFeedMock.address,
          swapRouterMock.address,
          slippageToleranceBps,
          uniswapPath
        )
      ).to.be.revertedWith('InvalidParam("Payment Adapter")');
    });

    it("should revert if dai to usd price feed is the zero address", async function () {
      const invalidDaiUsdPriceFeed = ethers.constants.AddressZero;
      await expect(
        DssVestTopUp.deploy(
          fakeUpkeepId,
          keeperRegistryMock.address,
          daiToken.address,
          linkToken.address,
          paymentAdapterMock.address,
          invalidDaiUsdPriceFeed,
          linkUsdPriceFeedMock.address,
          swapRouterMock.address,
          slippageToleranceBps,
          uniswapPath
        )
      ).to.be.revertedWith('InvalidParam("DAI/USD Price Feed")');
    });

    it("should revert if link to usd price feed is the zero address", async function () {
      const invalidLinkUsdPriceFeed = ethers.constants.AddressZero;
      await expect(
        DssVestTopUp.deploy(
          fakeUpkeepId,
          keeperRegistryMock.address,
          daiToken.address,
          linkToken.address,
          paymentAdapterMock.address,
          daiUsdPriceFeedMock.address,
          invalidLinkUsdPriceFeed,
          swapRouterMock.address,
          slippageToleranceBps,
          uniswapPath
        )
      ).to.be.revertedWith('InvalidParam("LINK/USD Price Feed")');
    });

    it("should revert if swap router is the zero address", async function () {
      const invalidSwapRouter = ethers.constants.AddressZero;
      await expect(
        DssVestTopUp.deploy(
          fakeUpkeepId,
          keeperRegistryMock.address,
          daiToken.address,
          linkToken.address,
          paymentAdapterMock.address,
          daiUsdPriceFeedMock.address,
          linkUsdPriceFeedMock.address,
          invalidSwapRouter,
          slippageToleranceBps,
          uniswapPath
        )
      ).to.be.revertedWith('InvalidParam("Uniswap Router")');
    });

    it("should revert if swap path has zero length", async function () {
      const invalidSwap = "0x";
      await expect(
        DssVestTopUp.deploy(
          fakeUpkeepId,
          keeperRegistryMock.address,
          daiToken.address,
          linkToken.address,
          paymentAdapterMock.address,
          daiUsdPriceFeedMock.address,
          linkUsdPriceFeedMock.address,
          swapRouterMock.address,
          slippageToleranceBps,
          invalidSwap
        )
      ).to.be.revertedWith('InvalidParam("Uniswap Path")');
    });

    it("should revert if price oracles have different decimals", async function () {
      daiUsdPriceFeedMock = await MockV3Aggregator.deploy(
        usdFeedDecimals + 1,
        daiUsdPrice
      );
      await expect(
        DssVestTopUp.deploy(
          fakeUpkeepId,
          keeperRegistryMock.address,
          daiToken.address,
          linkToken.address,
          paymentAdapterMock.address,
          daiUsdPriceFeedMock.address,
          linkUsdPriceFeedMock.address,
          swapRouterMock.address,
          slippageToleranceBps,
          swapRouterMock.address
        )
      ).to.be.revertedWith('InvalidParam("Price oracle")');
    });
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

  describe("Setters", function () {
    let randomAddress: Wallet;

    before(() => {
      randomAddress = ethers.Wallet.createRandom();
    });

    it("should set payment adapter", async function () {
      await topUp.setPaymentAdapter(randomAddress.address);
      expect(await topUp.paymentAdapter()).to.eq(randomAddress.address);
    });

    it("should revert if payment adapter is the zero address", async function () {
      await expect(
        topUp.setPaymentAdapter(ethers.constants.AddressZero)
      ).to.be.revertedWith('InvalidParam("Payment Adapter")');
    });

    it("should set keeper registry", async function () {
      await topUp.setKeeperRegistry(randomAddress.address);
      expect(await topUp.keeperRegistry()).to.eq(randomAddress.address);
    });

    it("should revert if keeeper registry address is the zero address", async function () {
      await expect(
        topUp.setKeeperRegistry(ethers.constants.AddressZero)
      ).to.be.revertedWith('InvalidParam("KeeperRegistry")');
    });

    it("should set upkeep id", async function () {
      const newUpkeepId = 1;
      await topUp.setUpkeepId(newUpkeepId);
      expect(await topUp.upkeepId()).to.eq(newUpkeepId);
    });

    it("should revert if upkeep id is 0", async function () {
      await expect(
        topUp.setUpkeepId(ethers.constants.AddressZero)
      ).to.be.revertedWith('InvalidParam("Upkeep ID")');
    });

    it("should set uniswap path", async function () {
      const randomBytes = utils.hexlify(utils.randomBytes(32));
      await topUp.setUniswapPath(randomBytes);

      expect(await topUp.uniswapPath()).to.eq(randomBytes);
    });

    it("should revert if uniswap path has 0 length", async function () {
      await expect(topUp.setUniswapPath("0x")).to.be.revertedWith(
        'InvalidParam("Uniswap Path")'
      );
    });

    it("should set slippage tolerance", async function () {
      const newSlippageBps = 250;
      await topUp.setSlippageTolerance(newSlippageBps);
      expect(await topUp.slippageToleranceBps()).to.eq(newSlippageBps);
    });
  });

  describe("Misc", async function () {
    it("should allow owner to recover funds", async function () {
      const mintedTokens = ethers.utils.parseEther("10.0");
      await daiToken.mint(topUp.address, mintedTokens);
      await topUp.recoverFunds(daiToken.address);
      expect(await daiToken.balanceOf(owner.address)).to.eq(mintedTokens);
    });
  });
});
