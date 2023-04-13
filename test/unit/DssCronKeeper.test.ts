import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  DssCronKeeper,
  DssVestTopUpMock,
  SampleJob,
  Sequencer,
} from "../../typechain";

const { HashZero } = ethers.constants;
const { formatBytes32String } = ethers.utils;

const ABI = [
  "function runJob(address job, bytes memory args)",
  "function refundUpkeep()",
];
const iface = new ethers.utils.Interface(ABI);
const refundUpkeepEncoded = iface.encodeFunctionData("refundUpkeep");

describe("DssCronKeeper", function () {
  let keeper: DssCronKeeper;
  let sequencer: Sequencer;
  let job: SampleJob;
  let topUpMock: DssVestTopUpMock;
  let runJobEncoded: string;

  beforeEach(async function () {
    const Sequencer = await ethers.getContractFactory("Sequencer");
    sequencer = await Sequencer.deploy();
    await sequencer.addNetwork(formatBytes32String("test"), 1);

    const SampleJob = await ethers.getContractFactory("SampleJob");
    job = await SampleJob.deploy(sequencer.address, 100);
    await sequencer.addJob(job.address);
    runJobEncoded = iface.encodeFunctionData("runJob", [job.address, "0x"]);

    const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
    keeper = await DssCronKeeper.deploy(
      sequencer.address,
      formatBytes32String("test")
    );

    const DssVestTopUpMock = await ethers.getContractFactory(
      "DssVestTopUpMock"
    );
    topUpMock = await DssVestTopUpMock.deploy();
    await keeper.setUpkeepRefunder(topUpMock.address);
  });

  describe("checkUpkeep", function () {
    it("should perform job if there are pending jobs", async function () {
      const [upkeepNeeded, perfromData] = await keeper.callStatic.checkUpkeep(
        HashZero
      );
      expect(upkeepNeeded).to.eq(true);
      expect(perfromData).to.eq(runJobEncoded);
    });

    it("should perform top up if checker returns true", async function () {
      await topUpMock.setChecker(true);
      const [upkeepNeeded, perfromData] = await keeper.callStatic.checkUpkeep(
        HashZero
      );
      expect(upkeepNeeded).to.eq(true);
      expect(perfromData).to.eq(refundUpkeepEncoded);
    });

    it("should return false if no pending jobs and no need for topUp", async function () {
      await keeper.performUpkeep(runJobEncoded);
      const [upkeepNeeded] = await keeper.callStatic.checkUpkeep(HashZero);
      expect(upkeepNeeded).to.eq(false);
    });

    it("should return false if it's not the network's turn", async function () {
      await sequencer.addNetwork(formatBytes32String("test2"), 100);
      const isAnotherNetworkTurn = await sequencer.isMaster(
        formatBytes32String("test2")
      );
      const [upkeepNeeded, performData] = await keeper.callStatic.checkUpkeep(
        ethers.constants.HashZero
      );

      expect(isAnotherNetworkTurn).to.equal(true);
      expect(upkeepNeeded).to.eq(false);
      expect(performData).to.eq("0x");
    });
  });

  describe("performUpkeep", function () {
    it("should execute pending job", async function () {
      await keeper.performUpkeep(runJobEncoded);
      expect(await job.last()).to.be.gt(0);
    });

    it("should not execute not pending job", async function () {
      await keeper.performUpkeep(runJobEncoded);
      const last = await job.last();

      expect(keeper.performUpkeep(runJobEncoded)).to.be.revertedWith(
        "failed to perform upkeep"
      );
      expect(await job.last()).to.eq(last);
    });

    it("should execute top up", async function () {
      const performTx = await keeper.performUpkeep(refundUpkeepEncoded);
      const performRc = await performTx.wait();
      const topUpEvent = performRc.events?.find(
        (e) => e.address === topUpMock.address
      );
      expect(topUpEvent).to.not.equal(undefined);
    });

    it("should emit event when job is executed", async function () {
      await expect(keeper.performUpkeep(runJobEncoded)).to.emit(
        keeper,
        "ExecutedJob"
      );
    });
  });

  describe("Owner", async function () {
    let owner: SignerWithAddress;
    let user: SignerWithAddress;

    beforeEach(async function () {
      [owner, user] = await ethers.getSigners();
    });

    it("should allow owner to change sequencer", async function () {
      const oldSequencer = await keeper.sequencer();
      await keeper.connect(owner).setSequencer(job.address);
      const newSequencer = await keeper.sequencer();
      expect(oldSequencer).to.not.equal(newSequencer);
    });

    it("should revert if sequencer address is zero address", async function () {
      await expect(
        keeper.setSequencer(ethers.constants.AddressZero)
      ).to.be.revertedWith("invalid sequencer address");
    });

    it("should not allow user to change sequencer", async function () {
      await expect(
        keeper.connect(user).setSequencer(job.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should allow owner to change network name", async function () {
      const oldNetwork = await keeper.network();
      await keeper.connect(owner).setNetwork(formatBytes32String("test3"));
      const newNetwork = await keeper.network();
      expect(newNetwork).to.not.equal(oldNetwork);
    });

    it("should revert if network name is blank", async function () {
      await expect(
        keeper.setNetwork(ethers.constants.HashZero)
      ).to.be.revertedWith("invalid network");
    });

    it("should not allow user to change network name", async function () {
      await expect(
        keeper.connect(user).setNetwork(formatBytes32String("test3"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
