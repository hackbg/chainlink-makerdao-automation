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
} from "../typechain";

const { AddressZero } = ethers.constants;
const { formatBytes32String, toUtf8Bytes, keccak256 } = ethers.utils;

describe("DssVestTopUp", function () {
  const minWithdrawAmt = BigNumber.from(100);
  const maxDepositAmt = BigNumber.from(1000);
  const initialUpkeepBalance = BigNumber.from(150);
  const upkeepThreshold = BigNumber.from(100);

  let topUp: DssVestTopUp;
  let dssVest: DssVestMintable;
  let vestId: BigNumber;
  let token: ERC20PresetMinterPauser;
  let keeperRegistryMock: KeeperRegistryMock;
  let daiJoinMock: DaiJoinMock;

  let admin: SignerWithAddress;

  before(async function () {
    [admin] = await ethers.getSigners();
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
    const swapRouterMock = await SwapRouterMock.deploy();

    // setup topup contract
    const DssVestTopUp = await ethers.getContractFactory("DssVestTopUp");
    topUp = await DssVestTopUp.deploy(
      dssVest.address,
      daiJoinMock.address,
      AddressZero, // vow
      token.address,
      keeperRegistryMock.address,
      0, // upkeepId
      swapRouterMock.address,
      AddressZero, // LINK token
      minWithdrawAmt,
      maxDepositAmt,
      upkeepThreshold
    );

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
      expect(await topUp.checker()).to.eq(false);
    });

    it("should return false if unpaid < minWithdrawAmt", async function () {
      await keeperRegistryMock.setUpkeepBalance(50);
      expect(await topUp.checker()).to.eq(false);
    });

    it("should return true if balance < threshold and unpaid > minWithdrawAmt", async function () {
      await keeperRegistryMock.setUpkeepBalance(50);
      await network.provider.send("evm_increaseTime", [100]);
      await network.provider.send("evm_mine");

      expect(await topUp.checker()).to.eq(true);
    });
  });

  describe("topUp", function () {
    beforeEach(async function () {
      await network.provider.send("evm_increaseTime", [1000]);
      await network.provider.send("evm_mine");
    });

    it("should vest accrued tokens", async function () {
      const unpaid = await dssVest.unpaid(vestId);
      await topUp.topUp();
      const vested = await token.balanceOf(topUp.address);

      expect(unpaid).to.eq(vested);
    });

    it("should return excess payment to surplus buffer", async function () {
      const unpaid = await dssVest.unpaid(vestId);
      const topUpTx = await topUp.topUp();

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

      expect(vowAddr).to.eq(AddressZero);
      expect(joinAmt).to.eq(unpaid.sub(maxDepositAmt));
    });

    it("should fund upkeep", async function () {
      await topUp.topUp();

      const upkeepInfo = await keeperRegistryMock.getUpkeep(0);
      expect(upkeepInfo.balance).to.eq(maxDepositAmt.add(initialUpkeepBalance));
    });
  });
});
