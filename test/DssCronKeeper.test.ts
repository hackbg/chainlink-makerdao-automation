import { expect } from "chai";
import { ethers } from "hardhat";
import { DssCronKeeper, SampleJob, Sequencer } from "../typechain";

const { HashZero } = ethers.constants;
const { formatBytes32String } = ethers.utils;

describe("DssCronKeeper", function () {
  let keeper: DssCronKeeper;
  let sequencer: Sequencer;
  let job: SampleJob;

  beforeEach(async function () {
    const Sequencer = await ethers.getContractFactory("Sequencer");
    sequencer = await Sequencer.deploy();
    await sequencer.file(formatBytes32String("window"), 1);
    await sequencer.addNetwork(formatBytes32String("test"));

    const SampleJob = await ethers.getContractFactory("SampleJob");
    job = await SampleJob.deploy(sequencer.address, 100);

    await sequencer.addJob(job.address);

    const DssCronKeeper = await ethers.getContractFactory("DssCronKeeper");
    keeper = await DssCronKeeper.deploy(
      sequencer.address,
      formatBytes32String("test")
    );
  });

  describe("checkUpkeep", function () {
    it("should return true if there are pending jobs", async function () {
      const [upkeepNeeded] = await keeper.callStatic.checkUpkeep(HashZero);
      expect(upkeepNeeded).to.eq(true);
    });

    it("should return false if no pending jobs", async function () {
      await keeper.performUpkeep(HashZero);
      const [upkeepNeeded] = await keeper.callStatic.checkUpkeep(HashZero);
      expect(upkeepNeeded).to.eq(false);
    });
  });

  describe("performUpkeep", function () {
    it("should execute pending job", async function () {
      await keeper.performUpkeep(HashZero);
      expect(await job.last()).to.be.gt(0);
    });

    it("should not execute not pending job", async function () {
      await keeper.performUpkeep(HashZero);
      const last = await job.last();

      await keeper.performUpkeep(HashZero);
      expect(await job.last()).to.eq(last);
    });
  });
});
