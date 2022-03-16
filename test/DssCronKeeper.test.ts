import { expect } from "chai";
import { ethers } from "hardhat";
import {
  DssCronKeeper,
  DssVestTopUpMock,
  SampleJob,
  Sequencer,
} from "../typechain";

const { HashZero } = ethers.constants;
const { formatBytes32String } = ethers.utils;

const ABI = [
  "function runJob(address job, bytes memory args)",
  "function runTopUp()",
];
const iface = new ethers.utils.Interface(ABI);
const runTopUpEndcoded = iface.encodeFunctionData("runTopUp");

describe("DssCronKeeper", function () {
  let keeper: DssCronKeeper;
  let sequencer: Sequencer;
  let job: SampleJob;
  let topUpMock: DssVestTopUpMock;
  let runJobEncoded: string;

  beforeEach(async function () {
    const Sequencer = await ethers.getContractFactory("Sequencer");
    sequencer = await Sequencer.deploy();
    await sequencer.file(formatBytes32String("window"), 1);
    await sequencer.addNetwork(formatBytes32String("test"));

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
    await keeper.setTopUp(topUpMock.address);
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
      expect(perfromData).to.eq(runTopUpEndcoded);
    });

    it("should return false if no pending jobs and no need for topUp", async function () {
      await keeper.performUpkeep(runJobEncoded);
      const [upkeepNeeded] = await keeper.callStatic.checkUpkeep(HashZero);
      expect(upkeepNeeded).to.eq(false);
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
      const performTx = await keeper.performUpkeep(runTopUpEndcoded);
      const performRc = await performTx.wait();
      const topUpEvent = performRc.events?.find(
        (e) => e.address === topUpMock.address
      );
      expect(topUpEvent).to.not.equal(undefined);
    });
  });
});
