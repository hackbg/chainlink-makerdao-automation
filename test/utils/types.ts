import { type BigNumber } from "ethers";

export interface Upkeep {
  Id: string;
  checkBlockNum: number;
  checkBlockHash: string;
  performData: string;
}

export interface ExtraParams {
  gasLimit: BigNumber;
  gasPrice: BigNumber;
}

export interface EncodeConfig {
  paymentPremiumPPB: BigNumber;
  flatFeeMicroLink: BigNumber;
  checkGasLimit: BigNumber;
  stalenessSeconds: BigNumber;
  gasCeilingMultiplier: BigNumber;
  minUpkeepSpend: BigNumber;
  maxCheckDataSize: BigNumber;
  maxPerformDataSize: BigNumber;
  maxPerformGas: BigNumber;
  fallbackGasPrice: BigNumber;
  fallbackLinkPrice: BigNumber;
  transcoder: string;
  registrar: string;
}
