import { BigNumber, Wallet, constants } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  KeeperRegistry20,
  KeeperRegistrar20,
  LinkToken,
} from "../../typechain";

const { HashZero } = ethers.constants;
const { formatBytes32String, Interface } = ethers.utils;

const linkEth = BigNumber.from(5000000000000000); // 1 Link = 0.005 Eth
const gasWei = BigNumber.from(1000000000); // 1 gwei
const EPOCH_AND_ROUND_5_1 =
  "0x0000000000000000000000000000000000000000000000000000000000000501";

export const KeeperRegistrarParams = {
  AUTO_APPROVE_CONFIG_TYPE: {
    NONE: 0,
    WHITELIST: 1,
    ALLOW_ALL: 2,
  },
  AUTO_APPROVE_MAX_ALLOWED: BigNumber.from(20),
  MIN_UPKEEP_SPEND: BigNumber.from("1000"),
};

export const KeeperRegistryParams = {
  F: 1,
};

export async function setupChainlinkAutomation(
  owner: SignerWithAddress,
  linkToken: LinkToken,
  linkNativeFeed: string,
  fastGasFeed: string
) {
  const logic = await deployKeeperRegistryLogic(
    linkToken,
    linkNativeFeed,
    fastGasFeed
  );

  const registry = await deployRegistry(logic.address);

  const registrar = await deployRegistrar(owner, linkToken, registry);

  const signersAddresses = getRegistrySigners().map((signer) => {
    return signer.address;
  });

  const [registrySigner] = getRegistrySigners();
  await configRegistry(
    registry,
    registrar.address,
    signersAddresses,
    KeeperRegistryParams.F
  );

  // fund registrySigner1 with some ETH so it can execute performUpkeep
  await owner.sendTransaction({
    to: registrySigner.address,
    value: ethers.utils.parseEther("1.0"),
  });
  return { registry, registrar };
}

async function deployKeeperRegistryLogic(
  linkToken: LinkToken,
  linkNativeFeed: string,
  fastGasFeed: string
) {
  const KeeperRegistryLogic = await ethers.getContractFactory(
    "KeeperRegistryLogic2_0"
  );
  const keeperRegistryLogic = (await KeeperRegistryLogic.deploy(
    0,
    linkToken.address,
    linkNativeFeed,
    fastGasFeed
  )) as KeeperRegistry20;
  return keeperRegistryLogic;
}

async function deployRegistry(keeperRegistryLogicAddress: string) {
  const Registry = await ethers.getContractFactory("KeeperRegistry2_0");
  const registry = (await Registry.deploy(
    keeperRegistryLogicAddress
  )) as KeeperRegistry20;
  return registry;
}

async function deployRegistrar(
  owner: SignerWithAddress,
  linkToken: LinkToken,
  registry: KeeperRegistry20
) {
  const KeeperRegistrar = await ethers.getContractFactory("KeeperRegistrar2_0");
  const registrar: KeeperRegistrar20 = (await KeeperRegistrar.connect(
    owner
  ).deploy(
    linkToken.address,
    KeeperRegistrarParams.AUTO_APPROVE_CONFIG_TYPE.ALLOW_ALL,
    KeeperRegistrarParams.AUTO_APPROVE_MAX_ALLOWED,
    registry.address,
    KeeperRegistrarParams.MIN_UPKEEP_SPEND
  )) as KeeperRegistrar20;
  return registrar;
}

function encodeReport(
  upkeeps: any,
  gasWeiReport = gasWei,
  linkEthReport = linkEth
) {
  const upkeepIds = upkeeps.map((u: any) => u.Id);
  const performDataTuples = upkeeps.map((u: any) => [
    u.checkBlockNum,
    u.checkBlockHash,
    u.performData,
  ]);
  return ethers.utils.defaultAbiCoder.encode(
    ["uint256", "uint256", "uint256[]", "tuple(uint32,bytes32,bytes)[]"],
    [gasWeiReport, linkEthReport, upkeepIds, performDataTuples]
  );
}

function signReport(reportContext: string[], report: any, signers: Wallet[]) {
  const reportDigest = ethers.utils.keccak256(report);
  const packedArgs = ethers.utils.solidityPack(
    ["bytes32", "bytes32[3]"],
    [reportDigest, reportContext]
  );
  const packedDigest = ethers.utils.keccak256(packedArgs);

  const signatures = [];
  for (const signer of signers) {
    signatures.push(signer._signingKey().signDigest(packedDigest));
  }
  const vs = signatures.map((i) => "0" + (i.v - 27).toString(16)).join("");
  return {
    vs: "0x" + vs.padEnd(64, "0"),
    rs: signatures.map((i) => i.r),
    ss: signatures.map((i) => i.s),
  };
}

function encodeConfig(config: any) {
  return ethers.utils.defaultAbiCoder.encode(
    [
      // eslint-disable-next-line no-multi-str
      "tuple(uint32 paymentPremiumPPB,uint32 flatFeeMicroLink,uint32 checkGasLimit,uint24 stalenessSeconds\
      ,uint16 gasCeilingMultiplier,uint96 minUpkeepSpend,uint32 maxPerformGas,uint32 maxCheckDataSize,\
      uint32 maxPerformDataSize,uint256 fallbackGasPrice,uint256 fallbackLinkPrice,address transcoder,\
      address registrar)",
    ],
    [config]
  );
}

async function configRegistry(
  registry: KeeperRegistry20,
  registrarAddress: string,
  signersAddress: string[],
  f: number
) {
  // settings from here https://github.com/smartcontractkit/chainlink/blob/develop/contracts/test/v0.8/keeper2_0/KeeperRegistry2_0.test.ts#L198-L212
  const payment = BigNumber.from(1);
  const flatFee = BigNumber.from(1);
  const staleness = BigNumber.from(438200);
  const ceiling = BigNumber.from(1);
  const maxGas = BigNumber.from(5000000);
  const fbGasEth = BigNumber.from(1);
  const fbLinkEth = BigNumber.from(1);
  const newMinUpkeepSpend = BigNumber.from(0);
  const newMaxCheckDataSize = BigNumber.from(1000);
  const newMaxPerformDataSize = BigNumber.from(1000);
  const newMaxPerformGas = BigNumber.from(5000000);

  const configVersion = 1;

  await registry.setConfig(
    signersAddress,
    signersAddress,
    f,
    encodeConfig({
      paymentPremiumPPB: payment,
      flatFeeMicroLink: flatFee,
      checkGasLimit: maxGas,
      stalenessSeconds: staleness,
      gasCeilingMultiplier: ceiling,
      minUpkeepSpend: newMinUpkeepSpend,
      maxCheckDataSize: newMaxCheckDataSize,
      maxPerformDataSize: newMaxPerformDataSize,
      maxPerformGas: newMaxPerformGas,
      fallbackGasPrice: fbGasEth,
      fallbackLinkPrice: fbLinkEth,
      transcoder: constants.AddressZero,
      registrar: registrarAddress,
    }),
    configVersion,
    HashZero
  );
}

async function transmit(
  registry: KeeperRegistry20,
  transmitter: Wallet,
  upkeepIds: any,
  signers: Wallet[],
  numSigners: number,
  extraParams?: any,
  performData?: any,
  checkBlockNum?: any,
  checkBlockHash?: any
) {
  const latestBlock = await ethers.provider.getBlock("latest");
  const configDigest = (await registry.getState()).state.latestConfigDigest;

  const upkeeps = [];
  for (let i = 0; i < upkeepIds.length; i++) {
    upkeeps.push({
      Id: upkeepIds[i],
      checkBlockNum: checkBlockNum || latestBlock.number,
      checkBlockHash: checkBlockHash || latestBlock.hash,
      performData: performData || "0x",
    });
  }

  const report = encodeReport(upkeeps);

  const sigs = signReport(
    [configDigest, EPOCH_AND_ROUND_5_1, HashZero],
    report,
    signers.slice(0, numSigners)
  );

  return registry
    .connect(transmitter)
    .transmit(
      [configDigest, EPOCH_AND_ROUND_5_1, HashZero],
      report,
      sigs.rs,
      sigs.ss,
      sigs.vs,
      { gasLimit: extraParams?.gasLimit, gasPrice: extraParams?.gasPrice }
    );
}

export async function keeperRegistryPerformUpkeep(
  registry: KeeperRegistry20,
  registrySigners: Wallet[],
  upkeepId: string,
  f: number
) {
  const registryCheckUpkeep = await registry
    .connect(constants.AddressZero)
    .callStatic.checkUpkeep(upkeepId);

  const { performData } = ethers.utils.defaultAbiCoder.decode(
    ["tuple(uint32 checkBlockNum, bytes32 checkBlockHash, bytes performData)"],
    registryCheckUpkeep.performData
  )[0];

  const tx = await transmit(
    registry,
    registrySigners[0],
    [upkeepId],
    registrySigners,
    f + 1,
    null,
    performData
  );
  return await tx.wait();
}

export function getRegistrySigners() {
  const signers: Wallet[] = [];
  const signer1 = new ethers.Wallet(
    "0x7777777000000000000000000000000000000000000000000000000000000001"
  ).connect(ethers.provider);
  const signer2 = new ethers.Wallet(
    "0x7777777000000000000000000000000000000000000000000000000000000002"
  ).connect(ethers.provider);
  const signer3 = new ethers.Wallet(
    "0x7777777000000000000000000000000000000000000000000000000000000003"
  ).connect(ethers.provider);
  const signer4 = new ethers.Wallet(
    "0x7777777000000000000000000000000000000000000000000000000000000004"
  ).connect(ethers.provider);
  const signer5 = new ethers.Wallet(
    "0x7777777000000000000000000000000000000000000000000000000000000005"
  ).connect(ethers.provider);

  signers.push(signer1, signer2, signer3, signer4, signer5);

  return signers;
}

export async function registerUpkeep(
  contractAddress: string,
  linkToken: LinkToken,
  keeperRegistrarAddress: string,
  adminAddress: string,
  adminEmail: string,
  upkeepName: string,
  gasLimit: number,
  offchainConfig: string,
  initialFunding: BigNumber,
  checkData: string
): Promise<string> {
  const KeeperRegistrarAbi = [
    "function register(string memory name, bytes calldata encryptedEmail, address upkeepContract, uint32 gasLimit, address adminAddress, bytes calldata checkData, bytes calldata offchainConfig, uint96 amount, address sender)",
  ];
  const iface = new Interface(KeeperRegistrarAbi);
  const registerEncoded = iface.encodeFunctionData("register", [
    upkeepName,
    formatBytes32String(adminEmail),
    contractAddress,
    gasLimit,
    adminAddress,
    checkData,
    offchainConfig,
    initialFunding,
    adminAddress,
  ]);
  const registerTx = await linkToken.transferAndCall(
    keeperRegistrarAddress,
    initialFunding,
    registerEncoded
  );
  // get upkeep id
  const registerRc = await registerTx.wait();
  const registrarEvents = registerRc.events?.filter(
    (e) => e.address === keeperRegistrarAddress
  );
  const registrationApprovedEvent = registrarEvents && registrarEvents[1];
  const upkeepIdHex = registrationApprovedEvent?.topics[2];
  return BigNumber.from(upkeepIdHex).toString();
}
