import { ethers } from "hardhat";
import { BigNumber } from "ethers";

const { formatBytes32String, Interface } = ethers.utils;

export async function registerUpkeep(
  contractAddress: string,
  linkTokenAddress: string,
  keeperRegistrarAddress: string,
  adminAddress: string,
  adminEmail: string,
  upkeepName: string,
  gasLimit: number,
  initialFunding: BigNumber,
  checkData: string,
  sourceId: number
): Promise<string> {
  const KeeperRegistrarAbi = [
    "function register(string memory name, bytes calldata encryptedEmail, address upkeepContract, uint32 gasLimit, address adminAddress, bytes calldata checkData, uint96 amount, uint8 source, address sender)",
  ];
  const iface = new Interface(KeeperRegistrarAbi);
  const registerEncoded = iface.encodeFunctionData("register", [
    upkeepName,
    formatBytes32String(adminEmail),
    contractAddress,
    gasLimit,
    adminAddress,
    checkData,
    initialFunding,
    sourceId,
    adminAddress,
  ]);
  const LinkTokenMock = await ethers.getContractFactory("LinkTokenMock");
  const linkToken = LinkTokenMock.attach(linkTokenAddress);
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
