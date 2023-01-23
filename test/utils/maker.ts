import { ethers } from "hardhat";
import { BigNumberish, Event } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  DssVestMintable,
  ERC20PresetMinterPauser,
  Sequencer,
} from "../../typechain";

const { formatBytes32String, toUtf8Bytes, keccak256 } = ethers.utils;

export async function setupSequencer(window: BigNumberish) {
  const Sequencer = await ethers.getContractFactory("Sequencer");
  const sequencer = await Sequencer.deploy();
  await sequencer.file(formatBytes32String("window"), window);
  return sequencer;
}

export async function setupSampleJob(
  sequencer: Sequencer,
  maxDuration: BigNumberish
) {
  const SampleJob = await ethers.getContractFactory("SampleJob");
  const job = await SampleJob.deploy(sequencer.address, maxDuration);
  await sequencer.addJob(job.address);
  return job;
}

export async function setupDaiToken(
  owner: SignerWithAddress,
  ownerBalance: BigNumberish
) {
  const ERC20 = await ethers.getContractFactory("ERC20PresetMinterPauser");
  const daiToken: ERC20PresetMinterPauser = await ERC20.deploy(
    "Test DAI",
    "DAI"
  );
  await daiToken.mint(owner.address, ownerBalance);
  await daiToken.deployed();
  return daiToken;
}

export async function deployDaiJoinMock(daiTokenAddress: string) {
  const DaiJoinMock = await ethers.getContractFactory("DaiJoinMock");
  const daiJoinMock = await DaiJoinMock.deploy(daiTokenAddress);
  await daiJoinMock.deployed();
  return daiJoinMock;
}

export async function setupDssVest(
  daiToken: ERC20PresetMinterPauser,
  cap: BigNumberish
) {
  const DssVest = await ethers.getContractFactory("DssVestMintable");
  const dssVest: DssVestMintable = await DssVest.deploy(daiToken.address);
  await dssVest.deployed();
  await dssVest.file(formatBytes32String("cap"), cap);
  await daiToken.grantRole(
    keccak256(toUtf8Bytes("MINTER_ROLE")),
    dssVest.address
  );
  return dssVest;
}

export async function createVest(
  dssVest: DssVestMintable,
  beneficiaryAddress: string,
  totalAmount: BigNumberish,
  durationInSec: number,
  cliffPeriodInSec: number,
  owner: SignerWithAddress
) {
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  const now = block.timestamp;
  const createVestTx = await dssVest.create(
    beneficiaryAddress,
    totalAmount,
    now,
    durationInSec,
    cliffPeriodInSec,
    owner.address
  );

  const createVestRc = await createVestTx.wait();
  const createVestEvent = createVestRc.events?.find(
    (e: Event) => e.event === "Init"
  );

  const [createVestValue] = createVestEvent?.args || [];
  return createVestValue;
}

export async function setupPaymentAdapter(
  dssVestAddress: string,
  vestId: number,
  treasuryAddress: string,
  daiJoinAddress: string,
  vowAddress: string,
  bufferMax: BigNumberish,
  minPayment: BigNumberish
) {
  const NetworkPaymentAdapter = await ethers.getContractFactory(
    "NetworkPaymentAdapter"
  );
  const paymentAdapter = await NetworkPaymentAdapter.deploy(
    dssVestAddress,
    vestId,
    treasuryAddress,
    daiJoinAddress,
    vowAddress
  );
  await paymentAdapter.file(formatBytes32String("bufferMax"), bufferMax);
  await paymentAdapter.file(formatBytes32String("minimumPayment"), minPayment);
  return paymentAdapter;
}
